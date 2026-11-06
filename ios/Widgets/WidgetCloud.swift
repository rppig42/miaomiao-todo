import CloudKit
import Foundation

/// 小组件直接和 CloudKit 说话：App 没开也能拿到 Mac 上的改动，勾选也能马上传上去。
/// 这里失败不要紧：状态文件里记着没传的文档，App 下次打开会接着传，合并规则保证结果一样。
enum WidgetCloud {
    private static let container = CKContainer(identifier: "iCloud.com.rppig42.todo")
    private static let zoneID = CKRecordZone.ID(zoneName: "Todo", ownerName: CKCurrentUserDefaultName)
    /// 令牌只在发它的环境里有效，换了环境要从头取。
    private static var tokenFile: URL {
        let env = (Bundle.main.object(forInfoDictionaryKey: "TodoCloudEnvironment") as? String) ?? "Production"
        return AppGroup.dir.appendingPathComponent("widget-token-\(env.lowercased())")
    }

    /// 把云端的新内容合并进状态文件。
    static func pull(core: WidgetCore) async {
        let db = container.privateCloudDatabase
        var token: CKServerChangeToken?
        if let data = try? Data(contentsOf: tokenFile) {
            token = try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
        }
        var items: [RemoteItem] = []
        var newest = token
        do {
            var more = true
            while more {
                let r = try await db.recordZoneChanges(inZoneWith: zoneID, since: newest)
                for result in r.modificationResultsByID.values {
                    guard let record = try? result.get().record,
                          let kind = record["kind"] as? String,
                          let payload = record["payload"] as? String else { continue }
                    items.append(RemoteItem(id: record.recordID.recordName, kind: kind, payload: payload))
                }
                newest = r.changeToken
                more = r.moreComing
            }
        } catch let e as CKError where e.code == .changeTokenExpired {
            // 令牌太旧了，丢掉，下次从头取。
            try? FileManager.default.removeItem(at: tokenFile)
            return
        } catch {
            return
        }
        if !items.isEmpty {
            let current = AppGroup.readState()
            guard let merged = core.absorb(state: current.text, items: items),
                  AppGroup.writeState(merged, ifUnchangedSince: current.modified) else { return }
        }
        // 合并存好了才前进，没存上下次重新取。
        if let newest, let data = try? NSKeyedArchiver.archivedData(withRootObject: newest, requiringSecureCoding: true) {
            try? data.write(to: tokenFile, options: .atomic)
        }
    }

    /// 把改动传上去。云端有更新的版本时先按字段合并。
    static func push(_ items: [RemoteItem], core: WidgetCore) async {
        let db = container.privateCloudDatabase
        let ids = items.map { CKRecord.ID(recordName: $0.id, zoneID: zoneID) }
        guard let found = try? await db.records(for: ids) else { return }
        var records: [CKRecord] = []
        for (item, id) in zip(items, ids) {
            let existing = try? found[id]?.get()
            let record = existing ?? CKRecord(recordType: "Item", recordID: id)
            var payload = item.payload
            if let server = existing?["payload"] as? String, let merged = core.merge(item.payload, server) {
                payload = merged
            }
            record["kind"] = item.kind
            record["payload"] = payload
            records.append(record)
        }
        _ = try? await db.modifyRecords(saving: records, deleting: [], savePolicy: .ifServerRecordUnchanged, atomically: false)
    }
}

/// 给一段异步工作限时。小组件的时间很紧，超时就用手上已有的数据。
func withTimeLimit(seconds: Double, _ work: @escaping @Sendable () async -> Void) async {
    await withTaskGroup(of: Void.self) { group in
        group.addTask { await work() }
        group.addTask { try? await Task.sleep(for: .seconds(seconds)) }
        await group.next()
        group.cancelAll()
    }
}
