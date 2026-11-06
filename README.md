# 喵喵の清单

仿 TickTick 的待办 App，有 Mac 版和 iPhone 版（带桌面小组件）。界面是设计稿 `design/todo-visual-directions.html` 的方向 A「琉璃」。

框架是 MyGo（Go + 系统 WebView），界面是 Preact，存储只依赖 iCloud（CloudKit 私有库），没有自己的服务器。

## 下载

- Mac：在 [Releases](../../releases) 下载 `miaomiao-todo-<版本>.dmg`，把 App 拖进“应用程序”。需要 macOS 14 或更新，Intel 和 Apple 芯片都能用。登录 iCloud 后在设备间同步，没登录也能在本机用。
- iPhone：没有安装包，要用 Xcode 自己装，见下面的 [iOS](#ios)。

## 结构

| 位置 | 内容 |
|---|---|
| `src/core/` | 业务规则，不依赖平台：文档库和合并（`store.ts`）、任务和各视图（`model.ts`）、自然语言（`nl.ts`）、日期和重复（`dates.ts`） |
| `src/ui/` | 界面 |
| `src/platform/` | 平台适配，Mac 是 `desktop.ts`，iPhone 是 `ios.ts` |
| `native/CloudSync.swift` | CloudKit 同步层，Mac 上编成动态库给 Go 调，iPhone 版直接编进 App |
| `*.go` | 窗口、菜单、通知、文件存储、调用同步层 |

### 数据和同步

- 本地存一份 `state.json`，离线、没登录 iCloud、空间满时照常能用。每天留一份备份，保留 14 天。
- 每个字段单独记时间戳，合并时逐字段取较新的值。两台设备改同一条任务的不同字段都不会丢。删除是打标记，放进垃圾桶。
- 云端只有一种记录 `Item`（`kind`、`payload` 两个字符串）。业务字段以后怎么变都不用改 CloudKit 的表结构。
- 同步层用 CKSyncEngine 上传；另外用自己的变更令牌定时查询（2 分钟一次，切回 App 时也查），因为引擎运行中不一定知道别的设备有改动。
- 上传遇到版本冲突时不重发旧内容：把云端版本交给页面合并，页面把结果推回来再发。
- 同步日志：`~/Library/Application Support/com.rppig42.todo/cloud.log`，只记事件和错误，不含任务内容。

数据目录是 `~/Library/Application Support/com.rppig42.todo/`。开发环境和生产环境的同步状态分开存，任务数据是同一份，切换环境后会全部上传一遍。

日常数据在**生产环境**（2026-11-06 起）。不要在这台 Mac 上用真实数据目录打开开发环境的包：它会把改动传到开发环境并标成已上传，生产环境就收不到这些改动，直到它们再被改一次。

### 重复规则

`src/core/repeat.ts`。每天、每周、每月、每年，每 N 个周期，工作日和节假日，农历，艾宾浩斯（第 1、2、4、7、15、30 天，复习完结束），可以按到期日期或完成日期算下一次。

- 农历用内置月份表（`cn-calendar.ts`，2024～2049），不用系统日历：系统日历在新月接近午夜时会差一天，比如把 2027 年春节算成 2 月 7 日。
- 法定假期来自国务院通知，数据在 `src/core/holidays-data.ts`。**每年 11 月前后公布下一年的安排，公布后运行 `node scripts/update-holidays.mjs` 再打包。** 还没公布的年份只能按法定天数算（元旦、除夕到初三、清明、5 月 1～2 日、端午、中秋、10 月 1～3 日），没有连休和调休。

## 开发

需要 Go 1.27（`go.mod` 里写了，go 命令会自动下载）和 Node。

```sh
npm install
npm run dev          # 开发版：ad-hoc 签名，没有 iCloud，只用本地存储
npm run signed developer-id   # 日常用：Developer ID 签名，连生产环境，不公证、不做 DMG
npm run signed       # 连 CloudKit 开发环境，只给 test:sync 用，只能在这台 Mac 上跑
npm run release      # 发布用的 DMG：通用二进制，签名、公证、装订，输出到 build/release
```

`mygo.json` 里故意不写权限和描述文件：`mygo dev` 是 ad-hoc 签名，带上会启动失败。签名包由 `scripts/build-signed.sh` 补上。

快捷键：⌃⌥Space 全局快速添加，⌘N 添加，⌘F 搜索，⌘1～⌘8 切换视图，⌘R 立即同步。选中任务后：空格完成，退格删除，回车改标题，↑↓ 移动。

## iOS

`ios/` 是 Swift 外壳加 WKWebView，界面和规则都用 `src/`（手机界面在 `src/ui/mobile.tsx`）。同步层直接编译 `native/CloudSync.swift`。工程由 xcodegen 生成，不入库。

小组件是 SwiftUI，规则来自 `src/core/widget.ts`，打包成 `widget-core.js` 在 JavaScriptCore 里运行，勾选重复任务时和 App 算得一样。App 和小组件通过 App Group 共用 `state.json`。小组件读数据前会先拉一次云端，勾选后也会直接上传，失败了等 App 打开时再传。

```sh
zsh scripts/ios.sh sim                 # 模拟器版
SIM=<UDID> npm run test:ios -- <截图目录>   # 在模拟器的 WKWebView 里走一遍界面，并渲染小组件
zsh scripts/ios.sh device              # 装到连着的 iPhone，要求 Xcode 里登录了开发者账号
```

连哪个 CloudKit 环境由 `ios/project.yml` 的 `CLOUD_ENVIRONMENT` 决定，App 和小组件的权限、`Info.plist` 的 `TodoCloudEnvironment` 都从它来。现在是 `Production`，和 Mac 的 Developer ID 包是同一份数据；调试签名也能连生产环境。

## 设置

外观、快捷键、开机启动、菜单栏图标和 Dock 数字只属于这台 Mac，存在数据目录的 `device.json`（`settings.go`）。每周开始于、新任务默认值和专注时长跟着 iCloud 走，是一个 `settings` 文档（`src/core/settings.ts`）。

## 测试

```sh
npm test             # 核心规则
npm run test:go      # 文件存储
npm run build:debug && npm run test:ui    # 在真实的 WKWebView 里走一遍界面
npm run build:debug && npm run test:lights # 交通灯的位置，会弹出真实窗口并进出全屏
npm run build:debug && npm run test:keys   # 快捷键走真实的按键分发，会弹出真实窗口
npm run signed && npm run test:sync       # 真实 CloudKit 端到端，只写开发环境，会清空开发环境的存储区
```

`test:ui` 可以传截图目录：`node scripts/wk-check.mjs /tmp/shots`。`TODO_THEME=dark` 看深色模式，`WK_BG=1` 铺彩色底看半透明层次。

诊断：`喵喵の清单.app/Contents/MacOS/喵喵の清单 --cloud-selftest` 在单独的存储区里读写一条，不碰正式数据。

## 签名和 iCloud

- Bundle ID `com.rppig42.todo`，容器 `iCloud.com.rppig42.todo`（**建了删不掉**），个人团队 `9PGVRX5XJ2`。App 的显示名可以随便改（`mygo.json` 的 `name`），这些 ID 和云端存储区名 `Todo` 不能改，否则连不上已有数据。
- 自己签名构建时，要把团队、Bundle ID、App Group 和容器换成自己的：`mygo.json`、`ios/project.yml`、`signing/`、`scripts/` 里的证书名，以及 `native/CloudSync.swift`、`ios/` 里写的容器名和 App Group。
- 描述文件放在 `signing/`，不进版本库。开发用的 2027-11-05 到期，Developer ID 的 2044 年到期。

重新生成描述文件：

```sh
cd signing/provision && xcodegen generate
# 开发用
xcodebuild -project TodoProv.xcodeproj -scheme TodoProv -derivedDataPath build -destination 'platform=macOS,arch=arm64' -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
cp ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/<新文件>.provisionprofile ../development.provisionprofile
# Developer ID
xcodebuild -project TodoProv.xcodeproj -scheme TodoProv -configuration Release -derivedDataPath build -destination 'generic/platform=macOS' -archivePath build/T.xcarchive -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath build/T.xcarchive -exportOptionsPlist export.plist -exportPath build/export -allowProvisioningUpdates
cp build/export/TodoProv.app/Contents/embedded.provisionprofile ../developer-id.provisionprofile
```

### 发布到生产环境

Developer ID 的包只连生产环境，而开发环境里自动生成的表结构不会自动过去。第一次要发布一次：
打开 [CloudKit 控制台](https://icloud.developer.apple.com/)，选 `iCloud.com.rppig42.todo` → Schema → Deploy Schema Changes。
`Item` 的字段以后不会变，发布一次就够（2026-11-06 已发布）。没发布时 App 会显示“同步失败”，本地数据不受影响。
