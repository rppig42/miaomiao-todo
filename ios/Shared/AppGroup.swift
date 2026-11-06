import Foundation

/// App 和小组件共用的文件。状态文件的格式和 Mac 版一样，合并规则都在页面和 widget-core.js 里。
enum AppGroup {
    static let id = "group.com.rppig42.todo"

    static var dir: URL {
        #if DEBUG
        if let d = ProcessInfo.processInfo.environment["TODO_DATA_DIR"] {
            try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true)
            return URL(fileURLWithPath: d)
        }
        #endif
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) ?? FileManager.default.temporaryDirectory
    }

    static var stateFile: URL { dir.appendingPathComponent("state.json") }

    static func readState() -> (text: String?, modified: Date?) {
        let url = stateFile
        let modified = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
        return (try? String(contentsOf: url, encoding: .utf8), modified)
    }

    /// 只在读过之后文件没被改过时才写。小组件读写要几秒，这期间 App 可能已经存过新内容，不能盖掉。
    @discardableResult
    static func writeState(_ text: String, ifUnchangedSince modified: Date?) -> Bool {
        let url = stateFile
        let now = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
        guard now == modified else { return false }
        return (try? text.write(to: url, atomically: true, encoding: .utf8)) != nil
    }
}
