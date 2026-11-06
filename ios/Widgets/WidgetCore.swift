import Foundation
import JavaScriptCore

/// 小组件的规则都来自 src/core/widget.ts，打包成 widget-core.js 在这里运行：
/// 勾选重复任务时下一次是哪天、时间戳怎么记，和 App 里完全一样。
struct WidgetData: Codable {
    struct Item: Codable, Identifiable {
        var id: String
        var title: String
        var time: String?
        var priority: Int
        var overdue: Bool
        var `repeat`: Bool
        var color: String?
    }

    var today: String
    var label: String
    var count: Int
    var tasks: [Item]
}

struct RemoteItem: Codable {
    var id: String
    var kind: String
    var payload: String
}

final class WidgetCore {
    private let context: JSContext
    private let api: JSValue

    init?() {
        guard let url = Bundle.main.url(forResource: "widget-core", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8),
              let context = JSContext() else { return nil }
        // JavaScriptCore 里没有浏览器的这些全局对象，规则代码只在存盘定时和生成 id 时用到。
        context.evaluateScript("""
        var setTimeout = function () { return 0 };
        var clearTimeout = function () {};
        var console = { log: function () {}, error: function () {} };
        var crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a } };
        """)
        context.evaluateScript(source)
        guard context.exception == nil, let api = context.objectForKeyedSubscript("TodoCore"), api.isObject else { return nil }
        self.context = context
        self.api = api
    }

    private func call(_ method: String, _ args: [Any]) -> String? {
        context.exception = nil
        let r = api.invokeMethod(method, withArguments: args)
        guard context.exception == nil, let r, r.isString else { return nil }
        return r.toString()
    }

    static func todayString(_ date: Date = Date()) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    func data(state: String?, today: String) -> WidgetData? {
        guard let json = call("data", [state ?? NSNull(), today]) else { return nil }
        return try? JSONDecoder().decode(WidgetData.self, from: Data(json.utf8))
    }

    /// 完成一条任务，返回新的状态和要传给云端的文档。
    func complete(state: String?, id: String, now: Date = Date()) -> (state: String, changed: [RemoteItem])? {
        struct Out: Decodable {
            var state: String
            var changed: [RemoteItem]
        }
        guard let json = call("complete", [state ?? NSNull(), id, now.timeIntervalSince1970 * 1000]),
              let out = try? JSONDecoder().decode(Out.self, from: Data(json.utf8)) else { return nil }
        return (out.state, out.changed)
    }

    func absorb(state: String?, items: [RemoteItem]) -> String? {
        guard let data = try? JSONEncoder().encode(items) else { return nil }
        return call("absorb", [state ?? NSNull(), String(decoding: data, as: UTF8.self)])
    }

    func merge(_ a: String, _ b: String) -> String? {
        call("merge", [a, b])
    }
}
