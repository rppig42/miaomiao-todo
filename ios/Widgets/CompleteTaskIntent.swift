import AppIntents
import Foundation
import WidgetKit

/// 小组件上的勾选框。
struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "完成任务"
    static var isDiscoverable = false

    @Parameter(title: "任务")
    var taskID: String

    init() {}

    init(taskID: String) {
        self.taskID = taskID
    }

    func perform() async throws -> some IntentResult {
        guard let core = WidgetCore() else { return .result() }
        // 文件可能正好被 App 改了，重来一次。
        for _ in 0..<3 {
            let current = AppGroup.readState()
            guard let out = core.complete(state: current.text, id: taskID) else { return .result() }
            if AppGroup.writeState(out.state, ifUnchangedSince: current.modified) {
                let changed = out.changed
                let box = CoreBox(core)
                await withTimeLimit(seconds: 8) { await WidgetCloud.push(changed, core: box.core) }
                break
            }
        }
        return .result()
    }
}

/// JSContext 不是 Sendable，但这里同一时间只有一处在用。
final class CoreBox: @unchecked Sendable {
    let core: WidgetCore
    init(_ core: WidgetCore) { self.core = core }
}
