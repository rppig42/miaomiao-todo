#if DEBUG
import UIKit
import WebKit

/// 在真实的 WKWebView 里跑脚本，见 scripts/ios-check.mjs。只在调试版存在。
/// 环境变量：TODO_SCRIPT 步骤文件，TODO_DATA_DIR 数据目录，TODO_SNAP_DIR 截图握手目录。
@MainActor
enum DebugScript {
    private struct Step: Decodable {
        var eval: String?
        var label: String?
        var snap: String?
        var sleep: Int?
        var wait: String?
    }

    static func startIfNeeded(on controller: WebViewController) {
        let env = ProcessInfo.processInfo.environment
        guard let path = env["TODO_SCRIPT"] else { return }
        setbuf(stdout, nil)
        Task { @MainActor in
            exit(await run(controller, path: path, snapDir: env["TODO_SNAP_DIR"]) ? 0 : 1)
        }
    }

    private static func run(_ controller: WebViewController, path: String, snapDir: String?) async -> Bool {
        guard let data = FileManager.default.contents(atPath: path), let steps = try? JSONDecoder().decode([Step].self, from: data) else {
            print("[script] 失败 读不了步骤文件")
            return false
        }
        guard await waitFor(controller, "return !!window.__todo") else {
            print("[script] 失败 页面没有启动")
            return false
        }
        var passed = true
        for step in steps {
            if let ms = step.sleep {
                try? await Task.sleep(for: .milliseconds(ms))
            } else if let name = step.snap, let snapDir {
                // 截图由外面的脚本用 simctl 做，这样能带上状态栏和键盘
                print("[snap] \(name)")
                let done = "\(snapDir)/\(name).done"
                while !FileManager.default.fileExists(atPath: done) {
                    try? await Task.sleep(for: .milliseconds(50))
                }
            } else if let condition = step.wait {
                if !(await waitFor(controller, condition)) {
                    print("[script] 失败 等待超时 \(step.label ?? condition)")
                    passed = false
                }
            } else if let code = step.eval {
                do {
                    let value = try await controller.webView.callAsyncJavaScript(code, arguments: [:], in: nil, contentWorld: .page)
                    print("[script] \(step.label ?? "") = \(encode(value))")
                } catch {
                    print("[script] 失败 \(step.label ?? ""): \(error)")
                    passed = false
                }
            }
        }
        return passed
    }

    private static func waitFor(_ controller: WebViewController, _ code: String) async -> Bool {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if let ok = try? await controller.webView.callAsyncJavaScript(code, arguments: [:], in: nil, contentWorld: .page) as? Bool, ok {
                return true
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return false
    }

    private static func encode(_ value: Any?) -> String {
        guard let value, !(value is NSNull) else { return "null" }
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else {
            if let text = value as? String { return "\"\(text)\"" }
            return "\(value)"
        }
        return String(decoding: data, as: UTF8.self)
    }
}
#endif
