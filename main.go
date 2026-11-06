package main

import (
	"context"
	_ "embed"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

//go:embed resources/tray.png
var trayIcon []byte

// Command 是菜单发给页面的命令。
var Command = mygo.NewEvent[string]("command")

// QuickAdd 是快速添加面板交给主窗口的一句话。
var QuickAdd = mygo.NewEvent[string]("quickadd")

// PanelShown 告诉面板页面它又显示了，要清空输入、重新读清单。
var PanelShown = mygo.NewEvent[string]("panelshown")

var (
	mainWindow *mygo.Window
	panel      *mygo.Window
	tray       *mygo.Tray
)

// Reminder 是一条要在指定时间弹出的通知。
type Reminder struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
	At    int64  `json:"at"`
}

// Native 提供页面做不到、或在 WebView 里不可靠的系统能力。
type Native struct {
	mu     sync.Mutex
	timers map[string]*time.Timer
	sigs   map[string]string
}

// SetReminders 用新的列表替换全部定时提醒。放在 Go 这边，窗口隐藏时页面被降速也能准时响。
func (n *Native) SetReminders(list []Reminder) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.timers == nil {
		n.timers = map[string]*time.Timer{}
		n.sigs = map[string]string{}
	}
	keep := map[string]bool{}
	now := time.Now().UnixMilli()
	for _, r := range list {
		if r.At <= now {
			continue
		}
		keep[r.ID] = true
		sig := r.Title + "\x00" + r.Body + "\x00" + time.UnixMilli(r.At).String()
		if n.sigs[r.ID] == sig {
			continue
		}
		if t := n.timers[r.ID]; t != nil {
			t.Stop()
		}
		n.sigs[r.ID] = sig
		reminder := r
		n.timers[r.ID] = time.AfterFunc(time.Duration(r.At-now)*time.Millisecond, func() { showReminder(reminder) })
	}
	for id, t := range n.timers {
		if !keep[id] {
			t.Stop()
			delete(n.timers, id)
			delete(n.sigs, id)
		}
	}
}

func showReminder(r Reminder) {
	if err := mygo.NewNotification(mygo.NotificationOptions{ID: r.ID, Title: r.Title, Body: r.Body}).Show(); err != nil {
		log.Println("通知:", err)
	}
}

// Notify 立刻弹一条通知。
func (*Native) Notify(title, body string) {
	showReminder(Reminder{ID: "now-" + time.Now().Format("150405.000"), Title: title, Body: body})
}

// SetBadge 在 Dock 图标上显示今天还没做的数量，0 表示不显示。设置里关掉时不显示。
func (*Native) SetBadge(n int) { settings.showBadgeCount(n) }

// SetFocusTitle 在菜单栏显示专注的剩余时间，空字符串表示不显示。
func (*Native) SetFocusTitle(s string) {
	if tray != nil {
		tray.SetTitle(s)
	}
}

// Confirm 询问一个不可撤销的操作，用户点了 action 按钮才返回 true。
func (*Native) Confirm(ctx context.Context, message, detail, action string) (bool, error) {
	res, err := mygo.Dialog.Message(mygo.MessageOptions{
		Parent:             mygo.CallerWindow(ctx),
		Type:               mygo.MessageWarning,
		Message:            message,
		Detail:             detail,
		Buttons:            []string{"取消", action},
		CancelButton:       0,
		DestructiveButtons: []int{1},
	})
	return err == nil && res.Button == 1, err
}

// SubmitQuickAdd 由面板调用：把这句话交给主窗口，然后收起面板。
func (*Native) SubmitQuickAdd(text string) {
	if text = strings.TrimSpace(text); text != "" {
		QuickAdd.Broadcast(text)
	}
	if panel != nil {
		panel.Hide()
	}
}

// HidePanel 收起快速添加面板。
func (*Native) HidePanel() {
	if panel != nil {
		panel.Hide()
	}
}

func command(name string) func(*mygo.MenuItem, *mygo.Window) {
	return func(*mygo.MenuItem, *mygo.Window) {
		showMain()
		Command.Broadcast(name)
	}
}

func showMain() {
	if mainWindow == nil {
		return
	}
	mainWindow.Show()
	mainWindow.Focus()
}

// toggleMain 显示或隐藏主窗口。窗口开着但不在最前面时，先把它叫到前面。
func toggleMain() {
	if mainWindow != nil && mainWindow.IsVisible() && mainWindow.IsFocused() {
		mainWindow.Hide()
		return
	}
	showMain()
}

// 系统角色的默认标题是英文，这里逐项写中文，保留角色带来的行为。
func appMenu() *mygo.Menu {
	sep := mygo.Separator
	return mygo.NewMenu([]*mygo.MenuItem{
		{Label: "喵喵の清单", Submenu: []*mygo.MenuItem{
			{Role: mygo.RoleAbout, Label: "关于喵喵の清单"},
			sep(),
			{Label: "设置…", Accelerator: "Cmd+,", Click: command("settings")},
			sep(),
			{Role: mygo.RoleHide, Label: "隐藏喵喵の清单"},
			{Role: mygo.RoleHideOthers, Label: "隐藏其他"},
			{Role: mygo.RoleUnhide, Label: "全部显示"},
			sep(),
			{Role: mygo.RoleQuit, Label: "退出喵喵の清单"},
		}},
		{Label: "文件", Submenu: []*mygo.MenuItem{
			{Label: "添加任务", Accelerator: settings.current().AddTask, Click: command("add")},
			{Label: "新建清单", Accelerator: "CmdOrCtrl+Shift+N", Click: command("newList")},
			sep(),
			{Label: "立即同步", Accelerator: "CmdOrCtrl+R", Click: func(*mygo.MenuItem, *mygo.Window) { Cloud{}.Fetch() }},
			sep(),
			{Role: mygo.RoleClose, Label: "关闭窗口"},
		}},
		{Label: "编辑", Submenu: []*mygo.MenuItem{
			{Label: "撤销", Accelerator: "CmdOrCtrl+Z", Click: command("undo")},
			{Role: mygo.RoleRedo, Label: "重做"},
			sep(),
			{Role: mygo.RoleCut, Label: "剪切"},
			{Role: mygo.RoleCopy, Label: "拷贝"},
			{Role: mygo.RolePaste, Label: "粘贴"},
			{Role: mygo.RoleSelectAll, Label: "全选"},
			sep(),
			{Label: "搜索", Accelerator: "CmdOrCtrl+F", Click: command("search")},
		}},
		{Label: "视图", Submenu: []*mygo.MenuItem{
			{Label: "今天", Accelerator: "CmdOrCtrl+1", Click: command("today")},
			{Label: "明天", Accelerator: "CmdOrCtrl+2", Click: command("tomorrow")},
			{Label: "最近 7 天", Accelerator: "CmdOrCtrl+3", Click: command("week")},
			{Label: "收件箱", Accelerator: "CmdOrCtrl+4", Click: command("inbox")},
			sep(),
			{Label: "日历", Accelerator: "CmdOrCtrl+5", Click: command("calendar")},
			{Label: "四象限", Accelerator: "CmdOrCtrl+6", Click: command("matrix")},
			{Label: "专注", Accelerator: "CmdOrCtrl+7", Click: command("focus")},
			{Label: "习惯", Accelerator: "CmdOrCtrl+8", Click: command("habits")},
			sep(),
			{Role: mygo.RoleToggleFullScreen, Label: "进入全屏"},
		}},
		{Role: mygo.RoleWindowMenu, Label: "窗口", Submenu: []*mygo.MenuItem{
			{Role: mygo.RoleMinimize, Label: "最小化"},
			{Role: mygo.RoleZoom, Label: "缩放"},
			sep(),
			{Role: mygo.RoleFront, Label: "前置全部窗口"},
		}},
	})
}

func createMain() {
	// 测试用临时数据目录时，也不要动真实窗口的位置和大小记录。
	stateKey := "main"
	if os.Getenv("TODO_DATA_DIR") != "" {
		stateKey = ""
	}
	mainWindow = mygo.NewWindow(mygo.WindowOptions{
		URL:                  "/",
		Title:                "喵喵の清单",
		Width:                1280,
		Height:               800,
		MinWidth:             860,
		MinHeight:            560,
		StateKey:             stateKey,
		TitleBarStyle:        mygo.TitleBarHidden,
		TrafficLightPosition: &mygo.Point{X: lightsInset, Y: lightsInset},
		Transparent:          true,
		Vibrancy:             mygo.VibrancyGlass,
		// 开机启动时不弹窗口，安静地等提醒。
		Hidden:               (os.Getenv("TODO_SCRIPT") != "" && os.Getenv("TODO_SHOW") == "") || mygo.App.WasOpenedAtLogin(),
		Page:                 mygo.PageOptions{BackgroundThrottling: mygo.ThrottlingOff},
	})
	keepTrafficLights(mainWindow)
	// 关窗只是隐藏：定时提醒和专注计时要继续走，再次打开也不用重新加载。
	mainWindow.OnClose(func(e *mygo.CloseEvent) {
		if !quitting {
			e.PreventDefault()
			mainWindow.Hide()
		}
	})
}

func createPanel() {
	panel = mygo.NewWindow(mygo.WindowOptions{
		URL:         "/?panel=quick",
		Panel:       true,
		Hidden:      true,
		Frameless:   true,
		Transparent: true,
		Vibrancy:    mygo.VibrancyGlass,
		CornerRadius: 22,
		Width:       640,
		Height:      132,
	})
	panel.OnClose(func(e *mygo.CloseEvent) {
		if !quitting {
			e.PreventDefault()
			panel.Hide()
		}
	})
	panel.OnBlur(panel.Hide)
}

func togglePanel() {
	if panel == nil {
		return
	}
	if panel.IsVisible() {
		panel.Hide()
		return
	}
	d := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
	w, h := panel.Size()
	panel.SetPosition(d.WorkArea.X+(d.WorkArea.Width-w)/2, d.WorkArea.Y+(d.WorkArea.Height-h)/3)
	panel.Show()
	PanelShown.Broadcast("")
}

func trayMenu() *mygo.Menu {
	return mygo.NewMenu([]*mygo.MenuItem{
		{Label: "显示喵喵の清单", Click: func(*mygo.MenuItem, *mygo.Window) { showMain() }},
		{Label: "快速添加…", Accelerator: settings.current().QuickAdd, Click: func(*mygo.MenuItem, *mygo.Window) { togglePanel() }},
		mygo.Separator(),
		{Role: mygo.RoleQuit, Label: "退出喵喵の清单"},
	})
}

// showTray 显示或移除菜单栏图标。要在主线程调用。
func showTray(on bool) {
	if !on {
		if tray != nil {
			tray.Destroy()
			tray = nil
		}
		return
	}
	if tray != nil {
		return
	}
	var err error
	tray, err = mygo.NewTray(mygo.TrayOptions{Icon: trayIcon, IconIsTemplate: true, ToolTip: "喵喵の清单", Menu: trayMenu()})
	if err != nil {
		tray = nil
		log.Println("菜单栏图标:", err)
	}
}

// refreshTrayMenu 让菜单栏菜单显示新的快捷键。要在主线程调用。
func refreshTrayMenu() {
	if tray != nil {
		tray.SetMenu(trayMenu())
	}
}

var quitting bool

// 退出前让页面把还没落盘的内容直接交给 Go：页面发起的异步保存来不及完成。
// 要在主线程以外调用：执行页面脚本要等主线程，在主线程上等自己会卡死。
func flushOnQuit(store *Store) {
	if mainWindow != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		v, err := mainWindow.Page().EvalContext(ctx, "if (!window.__todo) return ''; window.__todo.store.flushPush(); return window.__todo.serialize()")
		if data, ok := v.(string); err == nil && ok && data != "" {
			if err := store.Save(data); err != nil {
				log.Println("保存:", err)
			}
		}
	}
	flushCloud()
}

func main() {
	for _, a := range os.Args[1:] {
		switch a {
		case "--cloud-selftest":
			cloudSelfTest()
		case "--cloud-reset-dev":
			cloudResetDev()
		}
	}
	// 只有一份数据，也只跑一个实例。测试时用 TODO_DATA_DIR 隔开，可以多开。
	if os.Getenv("TODO_DATA_DIR") == "" {
		if !mygo.App.RequestSingleInstanceLock() {
			return
		}
		mygo.App.OnSecondInstance(func([]string, string) { showMain() })
	}
	settings.v = loadDevice()
	mygo.Theme.SetSource(mygo.ThemeSource(settings.v.Theme))
	if os.Getenv("TODO_THEME") == "dark" {
		mygo.Theme.SetSource(mygo.ThemeDark)
	}

	store := &Store{}
	mygo.Bind(store)
	mygo.Bind(&Native{})
	mygo.Bind(Cloud{})
	mygo.Bind(settings)

	mygo.App.SetMenu(appMenu())
	mygo.App.OnWindowAllClosed(func() {})
	mygo.App.OnActivate(func(bool) { showMain() })
	mygo.App.OnDidBecomeActive(func() {
		mygo.ClearNotifications()
		Cloud{}.Fetch()
	})
	mygo.App.OnNotificationClick(func(id string) {
		taskID, _, _ := strings.Cut(id, "/")
		showMain()
		Command.Broadcast("open:" + taskID)
	})
	flushed := false
	mygo.App.OnBeforeQuit(func(e *mygo.QuitEvent) {
		if flushed {
			quitting = true
			return
		}
		// 先取消这次退出，把数据存好再重新退出。
		e.PreventDefault()
		go func() {
			flushOnQuit(store)
			mygo.RunOnMain(func() {
				flushed = true
				mygo.App.Quit()
			})
		}()
	})

	mygo.App.WhenReady(func() {
		createMain()
		createPanel()
		registerGlobals(settings.current())
		showTray(settings.current().Tray)
		startScript(mainWindow)
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
