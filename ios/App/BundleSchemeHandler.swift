import WebKit

/// 用自定义协议提供打包进 App 的网页。file:// 下 ES 模块和 fetch 都受限，这样和 Mac 版的 mygo:// 行为一致。
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "mmapp"
    static let startURL = URL(string: "mmapp://localhost/")!

    private static let types = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json",
        "svg": "image/svg+xml",
        "png": "image/png",
    ]

    private let root = Bundle.main.bundleURL.appendingPathComponent("dist").standardizedFileURL

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        // 不能用 ../ 读到 dist 之外的文件
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
            task.didFinish()
            return
        }
        let type = Self.types[file.pathExtension] ?? "application/octet-stream"
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type])!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}
