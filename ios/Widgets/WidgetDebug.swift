#if DEBUG
import SwiftUI
import WidgetKit

/// 调试：在模拟器里跑一遍小组件的规则，并把三种尺寸的画面存成图片。
/// 模拟器的桌面没法用脚本操作，所以直接渲染小组件的视图。环境变量 TODO_WIDGET_SNAP 是图片目录。
enum WidgetDebug {
    static func runIfNeeded() {
        guard let dir = ProcessInfo.processInfo.environment["TODO_WIDGET_SNAP"] else { return }
        setbuf(stdout, nil)
        Task { @MainActor in
            await run(dir: dir)
            exit(0)
        }
    }

    @MainActor
    private static func run(dir: String) async {
        guard let core = WidgetCore() else {
            print("[widget] 失败 规则文件加载不了")
            return
        }
        print("[widget] 规则文件加载成功")
        let today = WidgetCore.todayString()
        let state = AppGroup.readState()
        guard let data = core.data(state: state.text, today: today) else {
            print("[widget] 失败 读不出数据")
            return
        }
        print("[widget] 今天 \(data.count) 项，列表 \(data.tasks.count) 项，\(data.label)")
        let entry = TodayEntry(date: Date(), data: data)
        render(entry, dir: dir, suffix: "")
        render(TodayEntry(date: Date(), data: WidgetData(today: today, label: data.label, count: 0, tasks: [])), dir: dir, suffix: "-empty")

        guard let first = data.tasks.first(where: { $0.repeat }) ?? data.tasks.first else { return }
        guard let out = core.complete(state: state.text, id: first.id) else {
            print("[widget] 失败 完成任务")
            return
        }
        print("[widget] 完成“\(first.title)”：要上传 \(out.changed.count) 条，重复=\(first.repeat)")
        print("[widget] 写回 \(AppGroup.writeState(out.state, ifUnchangedSince: state.modified))")
        print("[widget] 文件被别人改过时不写 \(!AppGroup.writeState(out.state, ifUnchangedSince: Date(timeIntervalSince1970: 0)))")
        let after = core.data(state: AppGroup.readState().text, today: today)
        print("[widget] 之后 \(after?.count ?? -1) 项")
    }

    @MainActor
    private static func render(_ entry: TodayEntry, dir: String, suffix: String) {
        let sizes: [(String, WidgetFamily, CGSize)] = [
            ("small", .systemSmall, CGSize(width: 170, height: 170)),
            ("medium", .systemMedium, CGSize(width: 364, height: 170)),
            ("large", .systemLarge, CGSize(width: 364, height: 382)),
        ]
        for scheme in [ColorScheme.light, .dark] {
            for (name, family, size) in sizes {
                let view = TodayWidgetView(entry: entry, forced: family)
                    .padding(16)
                    .frame(width: size.width, height: size.height)
                    .background(WidgetStyle.background)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .environment(\.colorScheme, scheme)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 3
                renderer.isOpaque = false
                if let data = renderer.uiImage?.pngData() {
                    let path = "\(dir)/\(name)-\(scheme == .dark ? "dark" : "light")\(suffix).png"
                    FileManager.default.createFile(atPath: path, contents: data)
                }
            }
        }
    }
}
#endif
