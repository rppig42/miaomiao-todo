import UIKit
import UserNotifications
import WebKit
import WidgetKit

/// 承载页面，并实现 src/platform/ios.ts 需要的原生能力。
final class WebViewController: UIViewController {
    private(set) static weak var shared: WebViewController?
    private static var pendingCommands: [String] = []

    private let store = LocalStore()
    private(set) var webView: WKWebView!
    private var keyboardInset: NSLayoutConstraint!
    private var pageReady = false
    private var cloudStarted = false
    private var fetchTimer: Timer?
    private var widgetTimer: Timer?

    override func viewDidLoad() {
        super.viewDidLoad()
        Self.shared = self
        let surface = UIColor(named: "Surface")
        view.backgroundColor = surface
        applyTheme()

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "todo")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = surface
        // 整页不滚动，滚动都发生在页面内部的列表里
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.delegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        keyboardInset = webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            keyboardInset,
        ])

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardWillChange), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)

        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.load(URLRequest(url: BundleSchemeHandler.startURL))
        #if DEBUG
        DebugScript.startIfNeeded(on: self)
        #endif
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        applyTheme()
    }

    // MARK: - 打开方式

    /// 小组件点进来的链接：mmtodo://add、mmtodo://task/<id>、mmtodo://today。
    func open(url: URL) {
        switch url.host {
        case "add": Self.command("add")
        case "task": Self.command("open:\(url.lastPathComponent)")
        default: Self.command("today")
        }
    }

    /// 冷启动时链接比页面先到，先记下来。
    static func queue(url: URL) {
        switch url.host {
        case "add": pendingCommands.append("add")
        case "task": pendingCommands.append("open:\(url.lastPathComponent)")
        default: break
        }
    }

    static func command(_ cmd: String) {
        guard let c = shared, c.pageReady else {
            pendingCommands.append(cmd)
            return
        }
        c.send(cmd)
    }

    private func send(_ cmd: String) {
        webView.evaluateJavaScript("window.__todoNative?.command(\(Self.literal(cmd)))")
    }

    private static func literal(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: s, options: .fragmentsAllowed) else { return "\"\"" }
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: - 生命周期

    /// 键盘弹出时把网页变矮，新建任务的面板才不会被挡住。
    @objc private func keyboardWillChange(_ note: Notification) {
        guard let info = note.userInfo, let end = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        let overlap = max(0, view.bounds.maxY - view.convert(end, from: nil).minY)
        keyboardInset.constant = -overlap
        let duration = (info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curve = (info[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
        UIView.animate(withDuration: duration, delay: 0, options: UIView.AnimationOptions(rawValue: curve << 16)) {
            self.view.layoutIfNeeded()
        }
    }

    /// 回到前台：小组件可能改过文件，定时器也停过。
    @objc private func didBecomeActive() {
        guard pageReady else { return }
        send("foreground")
        startFetchTimer()
    }

    /// 退到后台前把页面里还没写盘的内容存下来，小组件要读这个文件。
    @objc private func willResignActive() {
        fetchTimer?.invalidate()
        fetchTimer = nil
        cs_flush()
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(task) }
        webView.evaluateJavaScript("window.__todo?.flush()") { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                WidgetCenter.shared.reloadAllTimelines()
                UIApplication.shared.endBackgroundTask(task)
            }
        }
    }

    /// 在前台时每两分钟查一次云端，和 Mac 版一样。推送不一定及时。
    private func startFetchTimer() {
        guard cloudStarted, fetchTimer == nil else { return }
        fetchTimer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { _ in cs_fetch() }
    }

    // MARK: - 原生能力

    private func confirm(message: String, detail: String, action: String) async -> Bool {
        await withCheckedContinuation { done in
            let alert = UIAlertController(title: message, message: detail, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in done.resume(returning: false) })
            alert.addAction(UIAlertAction(title: action, style: .destructive) { _ in done.resume(returning: true) })
            present(alert, animated: true)
        }
    }

    private func startCloud() {
        guard !cloudStarted else { return }
        cloudStarted = true
        AppGroup.dir.path.withCString { dir in
            cs_start(dir) { text in
                let json = String(cString: text)
                DispatchQueue.main.async {
                    WebViewController.shared?.webView.evaluateJavaScript("window.__todoNative?.cloud(\(WebViewController.literal(json)))")
                }
            }
        }
        startFetchTimer()
    }

    private func setBadge(_ count: Int) async {
        var n = count
        if !DeviceSettings.load().badge { n = 0 }
        let center = UNUserNotificationCenter.current()
        // 真的有要显示的东西时才申请权限，第一次打开空白 App 不弹窗
        if n > 0 { await askPermission() }
        try? await center.setBadgeCount(n)
    }

    private func askPermission() async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["TODO_DATA_DIR"] != nil { return }
        #endif
        let center = UNUserNotificationCenter.current()
        if await center.notificationSettings().authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
    }

    private struct Alert: Decodable {
        var id: String
        var title: String
        var body: String
        var at: Double
    }

    private func decodeAlerts(_ value: Any?) -> [Alert] {
        guard let value, let data = try? JSONSerialization.data(withJSONObject: value) else { return [] }
        return (try? JSONDecoder().decode([Alert].self, from: data)) ?? []
    }

    /// 用新列表替换一组定时通知。isMine 用来分开任务提醒和专注结束。
    private func schedule(_ list: [Alert], replacing isMine: @escaping (String) -> Bool) async {
        let center = UNUserNotificationCenter.current()
        if !list.isEmpty { await askPermission() }
        let old = await center.pendingNotificationRequests().map(\.identifier).filter(isMine)
        center.removePendingNotificationRequests(withIdentifiers: old)
        for a in list {
            let wait = a.at / 1000 - Date().timeIntervalSince1970
            guard wait > 0 else { continue }
            let content = UNMutableNotificationContent()
            content.title = a.title
            content.body = a.body
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: wait, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: a.id, content: content, trigger: trigger))
        }
    }

    private func reloadWidgetsSoon() {
        widgetTimer?.invalidate()
        widgetTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { _ in
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    private func applyTheme() {
        let style: UIUserInterfaceStyle
        switch DeviceSettings.load().theme {
        case "light": style = .light
        case "dark": style = .dark
        default: style = .unspecified
        }
        view.window?.overrideUserInterfaceStyle = style
    }
}

/// 只属于这台手机的设置。字段和 src/platform/types.ts 的 DeviceSettings 对应，手机上用不到的留空。
struct DeviceSettings: Codable {
    var theme = "system"
    var badge = true

    private static var file: URL { AppGroup.dir.appendingPathComponent("device.json") }

    static func load() -> DeviceSettings {
        guard let data = try? Data(contentsOf: file), let v = try? JSONDecoder().decode(DeviceSettings.self, from: data) else { return DeviceSettings() }
        return v
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) { try? data.write(to: Self.file, options: .atomic) }
    }

    var forPage: [String: Any] {
        ["theme": theme, "badge": badge, "quickAdd": "", "toggleWindow": "", "addTask": "", "tray": false, "openAtLogin": false]
    }
}

// MARK: - 页面调用原生

extension WebViewController: WKScriptMessageHandlerWithReply {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any],
              let method = body["method"] as? String
        else { return (nil, "消息格式不对") }
        let args = body["args"] as? [Any] ?? []
        let string = { (i: Int) in i < args.count ? args[i] as? String ?? "" : "" }
        do {
            switch method {
            case "load":
                return (try await store.load(), nil)
            case "save":
                try await store.save(string(0))
                return (nil, nil)
            case "ready":
                pageReady = true
                let queued = Self.pendingCommands
                Self.pendingCommands = []
                queued.forEach(send)
                return (nil, nil)
            case "cloudAvailable":
                #if DEBUG
                if ProcessInfo.processInfo.environment["TODO_DATA_DIR"] != nil { return (false, nil) }
                #endif
                return (cs_available() == 1, nil)
            case "cloudStart":
                startCloud()
                return (nil, nil)
            case "cloudPush":
                string(0).withCString { cs_push($0) }
                return (nil, nil)
            case "cloudFetch":
                cs_fetch()
                return (nil, nil)
            case "setReminders":
                await schedule(decodeAlerts(args.first)) { $0.contains("/") }
                return (nil, nil)
            case "setFocusAlerts":
                await schedule(decodeAlerts(args.first)) { $0 == "focus-end" || $0 == "break-end" }
                return (nil, nil)
            case "setBadge":
                await setBadge((args.first as? NSNumber)?.intValue ?? 0)
                return (nil, nil)
            case "confirm":
                return (await confirm(message: string(0), detail: string(1), action: string(2)), nil)
            case "reloadWidgets":
                reloadWidgetsSoon()
                return (nil, nil)
            case "settings":
                return (DeviceSettings.load().forPage, nil)
            case "setTheme":
                var d = DeviceSettings.load()
                d.theme = string(0)
                d.save()
                applyTheme()
                return (nil, nil)
            case "setBadgeEnabled":
                var d = DeviceSettings.load()
                d.badge = (args.first as? NSNumber)?.boolValue ?? true
                d.save()
                if !d.badge { try? await UNUserNotificationCenter.current().setBadgeCount(0) }
                return (nil, nil)
            default:
                return (nil, "未知方法 \(method)")
            }
        } catch {
            return (nil, error.localizedDescription)
        }
    }
}

// MARK: - 导航

extension WebViewController: WKNavigationDelegate {
    /// 只显示 App 自带的页面。这个页面能调用原生方法，不能让它跳到外部网址。
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        action.request.url?.scheme == BundleSchemeHandler.scheme ? .allow : .cancel
    }

    /// 系统内存紧张时可能杀掉网页进程，不重新加载就是一个白屏。数据都已落盘，重载不会丢。
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        webView.reload()
    }
}

extension WebViewController: UIScrollViewDelegate {
    /// 输入框获得焦点时 WebKit 会滚动整页，键盘收起后页面可能停在偏移的位置。
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView.contentOffset != .zero { scrollView.contentOffset = .zero }
    }
}
