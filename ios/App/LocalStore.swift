import Foundation

/// 把页面的状态存成文件，放在 App 和小组件共用的目录里。先写临时文件再改名，崩溃也不会留下半个文件。
actor LocalStore {
    private let kept = 14

    func load() throws -> String {
        let url = AppGroup.stateFile
        guard FileManager.default.fileExists(atPath: url.path) else { return "" }
        return try String(contentsOf: url, encoding: .utf8)
    }

    func save(_ text: String) throws {
        backupOncePerDay()
        try text.write(to: AppGroup.stateFile, atomically: true, encoding: .utf8)
    }

    /// 每天第一次保存前留一份旧数据，保留最近 14 份。
    private func backupOncePerDay() {
        let fm = FileManager.default
        guard fm.fileExists(atPath: AppGroup.stateFile.path) else { return }
        let dir = AppGroup.dir.appendingPathComponent("backups")
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let format = DateFormatter()
        format.dateFormat = "yyyy-MM-dd"
        format.locale = Locale(identifier: "en_US_POSIX")
        let target = dir.appendingPathComponent("state-\(format.string(from: Date())).json")
        guard !fm.fileExists(atPath: target.path) else { return }
        try? fm.copyItem(at: AppGroup.stateFile, to: target)
        let all = ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasPrefix("state-") }.sorted()
        for name in all.dropLast(kept) { try? fm.removeItem(at: dir.appendingPathComponent(name)) }
    }
}
