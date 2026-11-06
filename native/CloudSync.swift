// iCloud 同步层：用 CKSyncEngine 把文档搬到 CloudKit 私有库，不懂业务。
// 合并规则在 src/core/store.ts。Mac 上编成动态库由 Go 调用，iPhone 版直接把这个文件编进 App。
//
// 云端只有一种记录 Item（kind、payload 两个字符串字段），payload 是文档的 JSON。
// 业务字段以后怎么变都不用改 CloudKit 的表结构，也就不用再发布一次到生产环境。

import CloudKit
import Foundation
import Security

private let containerID = "iCloud.com.rppig42.todo"
// 存储区名是数据的身份，和 App 的显示名无关，不能改：改了就找不到云端已有的数据。
private let zoneID = CKRecordZone.ID(zoneName: "Todo", ownerName: CKCurrentUserDefaultName)
private let recordType = "Item"

public typealias CCallback = @convention(c) (UnsafePointer<CChar>) -> Void

#if os(macOS)
private func entitlement(_ name: String) -> Any? {
    guard let task = SecTaskCreateFromSelf(nil) else { return nil }
    return SecTaskCopyValueForEntitlement(task, name as CFString, nil)
}

/// 没有 iCloud 权限时创建 CKContainer 会直接崩溃，所以先查签名里的权限。
private func isEntitled() -> Bool { entitlement("com.apple.developer.icloud-services") != nil }

/// 开发环境和生产环境的数据互不相通，同步状态也要分开存。
private func environmentName() -> String {
    (entitlement("com.apple.developer.icloud-container-environment") as? String) ?? "Production"
}
#else
// iOS 没有 SecTask，权限是工程里固定写好的。环境写在 ios/project.yml 的 CLOUD_ENVIRONMENT，
// 权限和 Info.plist 的 TodoCloudEnvironment 都从那里来，所以读 Info.plist 就知道连的是哪个。
private func isEntitled() -> Bool { true }

private func environmentName() -> String {
    (Bundle.main.object(forInfoDictionaryKey: "TodoCloudEnvironment") as? String) ?? "Production"
}
#endif

private struct Pending: Codable {
    var kind: String
    var payload: String
}

private struct Saved: Codable {
    var engine: Data?
    /// 每条记录的系统字段（版本标记）。保存时带上它，云端才知道这是在哪个版本上改的。
    var system: [String: Data] = [:]
    /// 还没确认上传成功的内容。
    var pending: [String: Pending] = [:]
    /// 主动查询存储区用的变更令牌，和引擎内部的令牌互相独立。
    var zoneToken: Data?
}

private final class SyncCore: CKSyncEngineDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let writeQueue = DispatchQueue(label: "todo.cloud.write")
    private let file: URL
    private let callback: CCallback
    private var saved = Saved()
    private var engine: CKSyncEngine?
    private var writeScheduled = false
    private var inFlight = 0
    private var lastError: (state: String, message: String)?
    private let logFile: URL
    private var sendScheduled = false

    init(dir: String, callback: @escaping CCallback) {
        let base = URL(fileURLWithPath: dir)
        self.file = base.appendingPathComponent("cloud-\(environmentName().lowercased()).json")
        self.logFile = base.appendingPathComponent("cloud.log")
        self.callback = callback
        if let size = (try? FileManager.default.attributesOfItem(atPath: logFile.path))?[.size] as? Int, size > 1_000_000 {
            try? FileManager.default.removeItem(at: logFile)
        }
        if let data = try? Data(contentsOf: file), let v = try? JSONDecoder().decode(Saved.self, from: data) {
            saved = v
        }
    }

    // MARK: 对外

    func start() {
        emit(["type": "status", "state": "syncing", "environment": environmentName()])
        Task {
            let status = (try? await CKContainer(identifier: containerID).accountStatus()) ?? .couldNotDetermine
            guard status == .available else {
                // 账号状态变化时再试，这里不建引擎，免得它报一堆错。
                self.emit(["type": "status", "state": "noAccount", "environment": environmentName()])
                return
            }
            self.makeEngine()
            self.emitStatus()
        }
    }

    func push(json: String) {
        guard let data = json.data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: String]] else { return }
        var ids: [CKRecord.ID] = []
        lock.lock()
        for item in list {
            guard let id = item["id"], let kind = item["kind"], let payload = item["payload"] else { continue }
            saved.pending[id] = Pending(kind: kind, payload: payload)
            ids.append(CKRecord.ID(recordName: id, zoneID: zoneID))
        }
        let engine = self.engine
        lock.unlock()
        scheduleWrite()
        engine?.state.add(pendingRecordZoneChanges: ids.map { .saveRecord($0) })
        log("push \(ids.count)")
        emitStatus()
        scheduleSend()
    }

    func pendingCount() -> Int {
        lock.withLock { saved.pending.count }
    }

    /// 引擎自己的调度依赖系统后台任务，不一定及时，这里主动发一次。
    private func scheduleSend() {
        let need = lock.withLock {
            let n = !sendScheduled
            sendScheduled = true
            return n
        }
        guard need else { return }
        writeQueue.asyncAfter(deadline: .now() + 0.3) {
            self.lock.withLock { self.sendScheduled = false }
            self.send()
        }
    }

    func fetch() {
        guard let engine = currentEngine() else {
            start()
            return
        }
        Task {
            do { try await engine.fetchChanges() } catch { self.report(error) }
            await self.pollZone()
        }
    }

    /// 引擎只查它认为有变更的存储区，这个判断靠推送和数据库级的变更列表，运行中不一定能及时知道。
    /// 所以再用自己的令牌直接查一次。内容到页面后按字段时间戳合并，和引擎重复收到也没关系。
    private func pollZone() async {
        let db = CKContainer(identifier: containerID).privateCloudDatabase
        var token: CKServerChangeToken?
        if let data = lock.withLock({ saved.zoneToken }) {
            token = try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
        }
        do {
            var more = true
            while more {
                let r = try await db.recordZoneChanges(inZoneWith: zoneID, since: token)
                let records = r.modificationResultsByID.values.compactMap { try? $0.get().record }
                let items = absorb(records)
                token = r.changeToken
                more = r.moreComing
                let encoded = try? NSKeyedArchiver.archivedData(withRootObject: r.changeToken, requiringSecureCoding: true)
                lock.withLock { saved.zoneToken = encoded }
                scheduleWrite()
                if !items.isEmpty {
                    log("poll records=\(items.count)")
                    emit(["type": "records", "items": items])
                }
            }
        } catch let e as CKError where e.code == .zoneNotFound {
            // 存储区还没建好，引擎会处理。
        } catch {
            report(error)
        }
    }

    /// 记下记录的版本标记，返回要交给页面的内容。
    private func absorb(_ records: [CKRecord]) -> [[String: String]] {
        lock.lock()
        defer { lock.unlock() }
        var items: [[String: String]] = []
        for r in records {
            saved.system[r.recordID.recordName] = systemFields(r)
            guard let kind = r["kind"] as? String, let payload = r["payload"] as? String else { continue }
            items.append(["id": r.recordID.recordName, "kind": kind, "payload": payload])
        }
        return items
    }

    func send() {
        guard let engine = currentEngine() else { return }
        Task {
            do { try await engine.sendChanges() } catch { self.report(error) }
        }
    }

    func flush() {
        writeQueue.sync { self.writeNow() }
    }

    // MARK: 引擎

    private func currentEngine() -> CKSyncEngine? {
        lock.lock()
        defer { lock.unlock() }
        return engine
    }

    private func makeEngine() {
        lock.lock()
        defer { lock.unlock() }
        guard engine == nil else { return }
        var state: CKSyncEngine.State.Serialization?
        if let d = saved.engine {
            state = try? JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: d)
        }
        let db = CKContainer(identifier: containerID).privateCloudDatabase
        let e = CKSyncEngine(CKSyncEngine.Configuration(database: db, stateSerialization: state, delegate: self))
        engine = e
        if state == nil {
            e.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
        }
        // 上次没传完的接着传。
        let ids = saved.pending.keys.map { CKRecord.ID(recordName: $0, zoneID: zoneID) }
        e.state.add(pendingRecordZoneChanges: ids.map { .saveRecord($0) })
        log("engine started, restored=\(state != nil), pending=\(ids.count)")
    }

    /// 换账号或退出登录：丢掉和旧账号有关的同步状态，本地的任务不动。
    private func resetEngine() {
        lock.lock()
        let old = engine
        engine = nil
        saved.engine = nil
        saved.system = [:]
        saved.pending = [:]
        saved.zoneToken = nil
        inFlight = 0
        lastError = nil
        lock.unlock()
        scheduleWrite()
        Task { await old?.cancelOperations() }
    }

    func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
        if case .stateUpdate = event {} else { log("event \(eventName(event))") }
        switch event {
        case .stateUpdate(let e):
            lock.withLock { saved.engine = try? JSONEncoder().encode(e.stateSerialization) }
            scheduleWrite()
        case .accountChange(let e):
            handleAccount(e)
        case .fetchedDatabaseChanges(let e):
            handleDatabase(e, syncEngine)
        case .fetchedRecordZoneChanges(let e):
            handleFetched(e)
        case .sentDatabaseChanges(let e):
            for failure in e.failedZoneSaves { report(failure.error) }
        case .sentRecordZoneChanges(let e):
            handleSent(e, syncEngine)
        case .willFetchChanges, .willSendChanges:
            lock.withLock {
                inFlight += 1
                lastError = nil
            }
            emitStatus()
        case .didFetchChanges, .didSendChanges:
            lock.withLock { inFlight = max(0, inFlight - 1) }
            emitStatus()
        default:
            break
        }
    }

    func nextRecordZoneChangeBatch(_ context: CKSyncEngine.SendChangesContext, syncEngine: CKSyncEngine) async -> CKSyncEngine.RecordZoneChangeBatch? {
        let scope = context.options.scope
        let changes = syncEngine.state.pendingRecordZoneChanges.filter { scope.contains($0) }
        return await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: changes) { [self] id in
            if let record = self.makeRecord(id) { return record }
            // 已经确认上传过了，不用再发。
            syncEngine.state.remove(pendingRecordZoneChanges: [.saveRecord(id)])
            return nil
        }
    }

    private func makeRecord(_ id: CKRecord.ID) -> CKRecord? {
        lock.lock()
        defer { lock.unlock() }
        guard let p = saved.pending[id.recordName] else { return nil }
        var record: CKRecord?
        if let data = saved.system[id.recordName], let coder = try? NSKeyedUnarchiver(forReadingFrom: data) {
            coder.requiresSecureCoding = true
            record = CKRecord(coder: coder)
            coder.finishDecoding()
        }
        let r = record ?? CKRecord(recordType: recordType, recordID: id)
        r["kind"] = p.kind
        r["payload"] = p.payload
        return r
    }

    private func systemFields(_ r: CKRecord) -> Data {
        let coder = NSKeyedArchiver(requiringSecureCoding: true)
        r.encodeSystemFields(with: coder)
        coder.finishEncoding()
        return coder.encodedData
    }

    private func eventName(_ event: CKSyncEngine.Event) -> String {
        switch event {
        case .accountChange(let e): return "account \(e.changeType)"
        case .fetchedDatabaseChanges(let e): return "fetchedDatabase mod=\(e.modifications.count) del=\(e.deletions.count)"
        case .fetchedRecordZoneChanges(let e): return "fetchedRecords mod=\(e.modifications.count) del=\(e.deletions.count)"
        case .sentDatabaseChanges(let e): return "sentDatabase saved=\(e.savedZones.count) failed=\(e.failedZoneSaves.map { $0.error.code.rawValue })"
        case .sentRecordZoneChanges(let e): return "sentRecords saved=\(e.savedRecords.count) failed=\(e.failedRecordSaves.map { $0.error.code.rawValue })"
        case .willFetchChanges: return "willFetch"
        case .didFetchChanges: return "didFetch"
        case .willSendChanges: return "willSend"
        case .didSendChanges: return "didSend"
        case .didFetchRecordZoneChanges(let e): return "didFetchZone error=\(e.error?.code.rawValue ?? 0)"
        default: return "other"
        }
    }

    private func handleAccount(_ e: CKSyncEngine.Event.AccountChange) {
        switch e.changeType {
        case .signIn:
            emit(["type": "account", "change": "signIn"])
        case .signOut:
            resetEngine()
            emit(["type": "account", "change": "signOut"])
            emit(["type": "status", "state": "noAccount", "environment": environmentName()])
        case .switchAccounts:
            resetEngine()
            makeEngine()
            emit(["type": "account", "change": "switch"])
        @unknown default:
            break
        }
    }

    private func handleDatabase(_ e: CKSyncEngine.Event.FetchedDatabaseChanges, _ engine: CKSyncEngine) {
        // 存储区被清掉（比如在系统设置里删了 iCloud 数据）：本地还有完整数据，重新建区、重新上传。
        guard e.deletions.contains(where: { $0.zoneID == zoneID }) else { return }
        lock.lock()
        saved.system = [:]
        saved.zoneToken = nil
        lock.unlock()
        engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
        scheduleWrite()
        emit(["type": "account", "change": "zoneDeleted"])
    }

    private func handleFetched(_ e: CKSyncEngine.Event.FetchedRecordZoneChanges) {
        let items = absorb(e.modifications.map { $0.record })
        lock.lock()
        for d in e.deletions {
            saved.system[d.recordID.recordName] = nil
        }
        lock.unlock()
        scheduleWrite()
        if !items.isEmpty { emit(["type": "records", "items": items]) }
    }

    private func handleSent(_ e: CKSyncEngine.Event.SentRecordZoneChanges, _ engine: CKSyncEngine) {
        var retry: [CKSyncEngine.PendingRecordZoneChange] = []
        var addZone = false
        var serverItems: [[String: String]] = []
        lock.lock()
        for r in e.savedRecords {
            let name = r.recordID.recordName
            saved.system[name] = systemFields(r)
            // 发送途中又改过的话，pending 里已经是新内容，要留着等下一轮。
            if let p = saved.pending[name], p.payload == r["payload"] as? String {
                saved.pending[name] = nil
            }
        }
        var firstError: Error?
        for f in e.failedRecordSaves {
            let id = f.record.recordID
            let name = id.recordName
            switch f.error.code {
            case .serverRecordChanged:
                // 别的设备先改了。这里不能直接重发：pending 里还是合并前的内容，发上去会盖掉对方的改动。
                // 把云端版本交给页面合并，页面一定会把合并结果重新推过来，到时再发。
                if let server = f.error.serverRecord {
                    saved.system[name] = systemFields(server)
                    if let kind = server["kind"] as? String, let payload = server["payload"] as? String {
                        serverItems.append(["id": name, "kind": kind, "payload": payload])
                    } else {
                        retry.append(.saveRecord(id))
                    }
                } else {
                    retry.append(.saveRecord(id))
                }
            case .zoneNotFound:
                addZone = true
                saved.system[name] = nil
                retry.append(.saveRecord(id))
            case .unknownItem:
                // 云端已经没有这条了。本地还留着就重新上传。
                saved.system[name] = nil
                retry.append(.saveRecord(id))
            case .networkFailure, .networkUnavailable, .zoneBusy, .serviceUnavailable, .notAuthenticated, .operationCancelled, .requestRateLimited, .batchRequestFailed:
                // 引擎会自己重试。
                break
            default:
                firstError = firstError ?? f.error
            }
        }
        lock.unlock()
        if addZone { engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))]) }
        if !retry.isEmpty { engine.state.add(pendingRecordZoneChanges: retry) }
        scheduleWrite()
        if !serverItems.isEmpty { emit(["type": "conflict", "items": serverItems]) }
        if let firstError { report(firstError) }
    }

    // MARK: 状态

    private func report(_ error: Error) {
        log("error \(error)")
        let state: String
        var message = error.localizedDescription
        switch (error as? CKError)?.code {
        case .networkUnavailable, .networkFailure:
            state = "offline"
        case .notAuthenticated:
            state = "noAccount"
        case .quotaExceeded:
            state = "error"
            message = "iCloud 空间已满，新内容暂时传不上去"
        case .operationCancelled, .partialFailure:
            // 部分失败里的每一条都在 handleSent 里单独处理过了，比如版本冲突。
            return
        case .invalidArguments where message.contains("production schema"):
            state = "error"
            message = "CloudKit 表结构还没发布到生产环境"
        default:
            state = "error"
        }
        lock.lock()
        lastError = (state, message)
        lock.unlock()
        emitStatus()
    }

    private func emitStatus() {
        lock.lock()
        let busy = inFlight > 0
        let err = lastError
        let waiting = saved.pending.count
        lock.unlock()
        var v: [String: Any] = ["type": "status", "environment": environmentName(), "pending": waiting]
        if let err {
            v["state"] = err.state
            v["message"] = err.message
        } else {
            v["state"] = busy ? "syncing" : "idle"
        }
        emit(v)
    }

    private func emit(_ v: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: v), let s = String(data: data, encoding: .utf8) else { return }
        s.withCString { callback($0) }
    }

    // MARK: 落盘

    /// 只记事件和错误，不记任务内容。反馈同步问题时看这个文件。
    private func log(_ s: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
        writeQueue.async {
            guard let data = line.data(using: .utf8) else { return }
            if let h = try? FileHandle(forWritingTo: self.logFile) {
                _ = try? h.seekToEnd()
                try? h.write(contentsOf: data)
                try? h.close()
            } else {
                try? data.write(to: self.logFile)
            }
        }
    }

    private func scheduleWrite() {
        lock.lock()
        let need = !writeScheduled
        writeScheduled = true
        lock.unlock()
        guard need else { return }
        writeQueue.asyncAfter(deadline: .now() + 0.5) { self.writeNow() }
    }

    private func writeNow() {
        lock.lock()
        writeScheduled = false
        let snapshot = saved
        lock.unlock()
        if let data = try? JSONEncoder().encode(snapshot) {
            try? data.write(to: file, options: .atomic)
        }
    }
}

private var core: SyncCore?

@_cdecl("cs_available")
public func cs_available() -> Int32 { isEntitled() ? 1 : 0 }

@_cdecl("cs_start")
public func cs_start(_ dir: UnsafePointer<CChar>, _ cb: @escaping CCallback) {
    guard isEntitled(), core == nil else { return }
    let c = SyncCore(dir: String(cString: dir), callback: cb)
    core = c
    c.start()
}

@_cdecl("cs_push")
public func cs_push(_ json: UnsafePointer<CChar>) { core?.push(json: String(cString: json)) }

@_cdecl("cs_fetch")
public func cs_fetch() { core?.fetch() }

@_cdecl("cs_send")
public func cs_send() { core?.send() }

@_cdecl("cs_flush")
public func cs_flush() { core?.flush() }

@_cdecl("cs_pending")
public func cs_pending() -> Int32 { Int32(core?.pendingCount() ?? 0) }

/// 测试用：清空开发环境里的正式存储区。生产环境什么也不做。
@_cdecl("cs_reset_dev")
public func cs_reset_dev(_ cb: @escaping CCallback) {
    func say(_ s: String) { s.withCString { cb($0) } }
    Task {
        guard isEntitled(), environmentName() == "Development" else { say("skip: not development"); say("END"); return }
        do {
            _ = try await CKContainer(identifier: containerID).privateCloudDatabase.deleteRecordZone(withID: zoneID)
            say("zone deleted")
        } catch {
            say("reset: \(error)")
        }
        say("END")
    }
}

/// 诊断用：不碰正式数据，在单独的存储区里写一条再删掉。
@_cdecl("cs_selftest")
public func cs_selftest(_ cb: @escaping CCallback) {
    func say(_ s: String) { s.withCString { cb($0) } }
    Task {
        guard isEntitled() else { say("entitlement: missing"); say("END"); return }
        say("entitlement: ok (\(environmentName()))")
        let container = CKContainer(identifier: containerID)
        do {
            let status = try await container.accountStatus()
            say("accountStatus: \(status.rawValue) (1=available)")
            let db = container.privateCloudDatabase
            let zone = CKRecordZone(zoneName: "SelfTest")
            _ = try await db.save(zone)
            say("zone save: ok")
            let rid = CKRecord.ID(recordName: "selftest-\(Int(Date().timeIntervalSince1970))", zoneID: zone.zoneID)
            let rec = CKRecord(recordType: recordType, recordID: rid)
            rec["kind"] = "selftest"
            rec["payload"] = "你好 iCloud"
            do {
                _ = try await db.save(rec)
                let got = try await db.record(for: rid)
                say("record: \(got["payload"] as? String ?? "?")")
                _ = try await db.deleteRecord(withID: rid)
            } catch {
                say("record error: \(error)")
            }
            _ = try await db.deleteRecordZone(withID: zone.zoneID)
            say("zone delete: ok")
        } catch {
            say("error: \(error)")
        }
        say("END")
    }
}
