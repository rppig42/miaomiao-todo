import SwiftUI
import UserNotifications
import WidgetKit

// iOS 版是原生外壳 + WKWebView，规则和界面都和 Mac 版共用 ../src。
// 小组件是 SwiftUI，规则同样来自 src/core（见 Widgets/WidgetCore.swift）。
@main
struct TodoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            // 安全区和键盘都由 WebViewController 和页面自己处理
            WebHost()
                .ignoresSafeArea()
                .onOpenURL { WebViewController.shared?.open(url: $0) ?? WebViewController.queue(url: $0) }
        }
    }
}

private struct WebHost: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        application.registerForRemoteNotifications()
        #if DEBUG
        WidgetDebug.runIfNeeded()
        #endif
        return true
    }

    /// CloudKit 的推送：别的设备改了数据。小组件刷新时会自己去云端取。
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler done: @escaping (UIBackgroundFetchResult) -> Void) {
        WidgetCenter.shared.reloadAllTimelines()
        done(.newData)
    }

    /// App 开着时提醒也要弹出来。
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    /// 点通知打开对应的任务。提醒的 id 是“任务/提前分钟”。
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let id = response.notification.request.identifier
        guard let slash = id.firstIndex(of: "/") else { return }
        let task = String(id[..<slash])
        await MainActor.run { WebViewController.command("open:\(task)") }
    }
}
