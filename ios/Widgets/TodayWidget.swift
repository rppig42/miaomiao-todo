import AppIntents
import SwiftUI
import WidgetKit

struct TodayEntry: TimelineEntry {
    var date: Date
    var data: WidgetData

    static let sample = TodayEntry(date: Date(), data: WidgetData(today: "", label: "11月5日 周四", count: 4, tasks: [
        .init(id: "1", title: "续交宽带费", time: nil, priority: 2, overdue: true, repeat: false, color: nil),
        .init(id: "2", title: "产品周会", time: "09:30", priority: 0, overdue: false, repeat: false, color: nil),
        .init(id: "3", title: "Q4 预算发给财务", time: "11:00", priority: 3, overdue: false, repeat: false, color: nil),
        .init(id: "4", title: "取快递", time: "18:00", priority: 1, overdue: false, repeat: false, color: nil),
    ]))
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        // 小组件库里的预览用示例内容；放到桌面前用真实数据。
        completion(context.isPreview ? .sample : Self.current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        Task {
            // 先看看云端有没有新东西：Mac 上加的任务不用打开 App 也能看到。
            if let core = WidgetCore() {
                let box = CoreBox(core)
                await withTimeLimit(seconds: 6) { await WidgetCloud.pull(core: box.core) }
            }
            let now = Date()
            let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86400))
            let next = min(midnight, now.addingTimeInterval(30 * 60))
            completion(Timeline(entries: [Self.current(now)], policy: .after(next)))
        }
    }

    static func current(_ now: Date = Date()) -> TodayEntry {
        let today = WidgetCore.todayString(now)
        let data = WidgetCore()?.data(state: AppGroup.readState().text, today: today)
        return TodayEntry(date: now, data: data ?? WidgetData(today: today, label: "", count: 0, tasks: []))
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodayWidget", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
                .containerBackground(for: .widget) { WidgetStyle.background }
        }
        .configurationDisplayName("今天")
        .description("今天要做的事，可以直接勾选完成。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

enum WidgetStyle {
    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light) })
    }

    static let accent = dynamic(0x2F6BFF, 0x5B8BFF)
    static let red = dynamic(0xE5484D, 0xFF6369)
    static let orange = dynamic(0xF09A1A, 0xFFB224)
    static let check = dynamic(0xB2B7C2, 0x6A6F7A)
    static let background = LinearGradient(colors: [dynamic(0xDCE8FB, 0x1C2A44), dynamic(0xF3F5F9, 0x14161B)], startPoint: .top, endPoint: .bottom)

    static func priority(_ p: Int) -> Color {
        switch p {
        case 3: return red
        case 2: return orange
        case 1: return accent
        default: return check
        }
    }
}

extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}

private struct TaskLine: View {
    let task: WidgetData.Item
    var showTime = true
    var fontSize: CGFloat = 14

    var body: some View {
        HStack(spacing: 8) {
            Button(intent: CompleteTaskIntent(taskID: task.id)) {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .strokeBorder(WidgetStyle.priority(task.priority), lineWidth: 1.6)
                    .frame(width: 17, height: 17)
                    .contentShape(Rectangle().inset(by: -6))
            }
            .buttonStyle(.plain)
            .widgetAccentable()
            Link(destination: URL(string: "mmtodo://task/\(task.id)")!) {
                HStack(spacing: 4) {
                    Text(task.title)
                        .font(.system(size: fontSize))
                        // 不能用 .primary：它取当前的前景色，而 Link 的前景色是强调色。
                        .foregroundStyle(Color.primary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if showTime, let time = task.time {
                        Text(time)
                            .font(.system(size: 12).monospacedDigit())
                            .foregroundStyle(task.overdue ? WidgetStyle.red : WidgetStyle.accent)
                    } else if showTime, task.overdue {
                        Text("过期")
                            .font(.system(size: 12))
                            .foregroundStyle(WidgetStyle.red)
                    }
                }
            }
        }
    }
}

private struct AddButton: View {
    var size: CGFloat = 30

    var body: some View {
        Link(destination: URL(string: "mmtodo://add")!) {
            Image(systemName: "plus")
                .font(.system(size: size * 0.5, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(WidgetStyle.accent, in: Circle())
        }
        .widgetAccentable()
    }
}

private struct EmptyToday: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 26, weight: .light))
                .foregroundStyle(WidgetStyle.accent)
            Text("今天没有要做的事")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry
    /// 调试出图时指定尺寸。
    var forced: WidgetFamily?

    private var data: WidgetData { entry.data }

    var body: some View {
        Group {
            switch forced ?? family {
            case .systemSmall: small
            case .systemLarge: large
            default: medium
            }
        }
        .widgetURL(URL(string: "mmtodo://today"))
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text("今天").font(.system(size: 17, weight: .bold))
                Spacer()
                if data.count > 0 {
                    Text("\(data.count)")
                        .font(.system(size: 17, weight: .bold).monospacedDigit())
                        .foregroundStyle(WidgetStyle.accent)
                        .widgetAccentable()
                }
            }
            if data.tasks.isEmpty {
                EmptyToday()
            } else {
                ForEach(data.tasks.prefix(4)) { TaskLine(task: $0, showTime: false, fontSize: 13) }
                Spacer(minLength: 0)
            }
        }
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(data.count)")
                    .font(.system(size: 38, weight: .semibold).monospacedDigit())
                    .foregroundStyle(WidgetStyle.accent)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .widgetAccentable()
                Text("今天").font(.system(size: 14, weight: .semibold))
                Text(shortDate).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                AddButton()
            }
            .frame(width: 70, alignment: .leading)
            if data.tasks.isEmpty {
                EmptyToday()
            } else {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(data.tasks.prefix(4)) { TaskLine(task: $0) }
                    Spacer(minLength: 0)
                }
                .padding(.top, 4)
            }
        }
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 6) {
                Text("今天").font(.system(size: 22, weight: .bold))
                if data.count > 0 {
                    Text("\(data.count)")
                        .font(.system(size: 22, weight: .bold).monospacedDigit())
                        .foregroundStyle(WidgetStyle.accent)
                        .widgetAccentable()
                }
                Text(shortDate).font(.system(size: 12)).foregroundStyle(.secondary).padding(.leading, 2)
                Spacer()
                AddButton()
            }
            if data.tasks.isEmpty {
                EmptyToday()
            } else {
                VStack(alignment: .leading, spacing: 11) {
                    ForEach(data.tasks.prefix(10)) { TaskLine(task: $0, fontSize: 15) }
                }
                Spacer(minLength: 0)
                if data.count > 10 {
                    Text("还有 \(data.count - 10) 项")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    /// 11月5日 周四 太长时只留日期。
    private var shortDate: String {
        data.label.split(separator: " ").first.map(String.init) ?? data.label
    }
}
