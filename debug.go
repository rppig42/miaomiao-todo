package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/ebitengine/purego"
	"github.com/ebitengine/purego/objc"
	"github.com/egoist/mygo"
)

// 在真实的 WKWebView 里跑脚本：Chrome 里通过的东西，这里不一定长得一样。
// 只有设置了 TODO_SCRIPT 才会运行，正常使用不会触发。见 scripts/wk-check.mjs。
type scriptStep struct {
	// Eval 是一段异步函数体，用 return 返回结果。
	Eval  string `json:"eval"`
	Label string `json:"label"`
	// Snap 截图保存到 TODO_SNAP_DIR/<Snap>.png。
	Snap string `json:"snap"`
	// Sleep 是等待的毫秒数。
	Sleep int `json:"sleep"`
	// Wait 是一段返回布尔值的代码，最多等 Timeout 秒（默认 20）直到它为真。
	Wait    string `json:"wait"`
	Timeout int    `json:"timeout"`
	// Panel 打开快速添加面板，把这段代码放到面板页面里运行。
	Panel string `json:"panel"`
	// PanelSnap 给面板截图。
	PanelSnap string `json:"panelSnap"`
	// Native 打印窗口的原生视图层级，确认系统材质真的装上了。截图拍不到窗口后面的材质。
	Native bool `json:"native"`
	// Lights 打印交通灯的实际位置。页面截图拍不到它们。
	Lights string `json:"lights"`
	// Shot 拍整个窗口（含交通灯和系统材质），保存到 TODO_SNAP_DIR/<Shot>.png。
	Shot string `json:"shot"`
	// Key 把一次按键交给系统分发，和真实按键走一样的路，比如 "cmd+n"。全局快捷键不走这里。
	Key string `json:"key"`
	// Hotkeys 打印这些全局快捷键有没有注册上，比如 ["Ctrl+Alt+Space"]，顺带打印菜单栏图标在不在。
	Hotkeys []string `json:"hotkeys"`
	// Win 操作窗口：hide、show、focus、minimize、restore、maximize、unmaximize、fullscreen、windowed；
	// away 切到别的应用，让窗口失去焦点；reset 把交通灯放回系统默认位置，模拟被系统布局覆盖；
	// screens 把窗口依次挪到每块显示器上再挪回来。
	Win string `json:"win"`
}

type nsRect struct{ X, Y, W, H float64 }

// lightsDump 打印关闭按钮以及它往上每一层视图的 frame。
func lightsDump(win *mygo.Window, label string) string {
	var b strings.Builder
	mygo.RunOnMain(func() {
		w := objc.ID(win.NativeHandle())
		frame := objc.Send[nsRect](w, objcSel("frame"))
		xs := lightsXs(w)
		fmt.Fprintf(&b, "[lights] %s window=%.0fx%.0f screen=%.0f key=%v healed=%d xs=%.0f,%.0f,%.0f\n", label, frame.W, frame.H, frame.X, objc.Send[bool](w, objcSel("isKeyWindow")), lightsHealed.Load(), xs[0], xs[1], xs[2])
		v := objc.Send[objc.ID](w, objcSel("standardWindowButton:"), 0)
		for depth := 0; v != 0 && depth < 5; depth++ {
			f := objc.Send[nsRect](v, objcSel("frame"))
			fmt.Fprintf(&b, "[lights]   %s frame=(%.1f,%.1f %.1fx%.1f)\n", nsString(v.Send(objcSel("className"))), f.X, f.Y, f.W, f.H)
			v = v.Send(objcSel("superview"))
		}
	})
	return b.String()
}

// sendKey 合成一次按键交给 NSApp 分发。⌘ 组合键会先走 performKeyEquivalent，页面和菜单谁先拿到和真实按键一样。
func sendKey(win *mygo.Window, spec string) {
	codes := map[string]uint16{"n": 45, "k": 40, "j": 38, "f": 3, "esc": 53, "space": 49, ",": 43}
	const shift, ctrl, alt, cmd = 1 << 17, 1 << 18, 1 << 19, 1 << 20
	flags := uint(0)
	parts := strings.Split(spec, "+")
	key := parts[len(parts)-1]
	for _, p := range parts[:len(parts)-1] {
		flags |= map[string]uint{"shift": shift, "ctrl": ctrl, "alt": alt, "cmd": cmd}[p]
	}
	chars := key
	if len(key) > 1 {
		chars = map[string]string{"esc": "\x1b", "space": " "}[key]
	}
	mygo.RunOnMain(func() {
		w := objc.ID(win.NativeHandle())
		num := objc.Send[int](w, objcSel("windowNumber"))
		app := objc.ID(objc.GetClass("NSApplication")).Send(objcSel("sharedApplication"))
		for _, kind := range []uint{10, 11} { // keyDown、keyUp
			ev := objc.ID(objc.GetClass("NSEvent")).Send(
				objcSel("keyEventWithType:location:modifierFlags:timestamp:windowNumber:context:characters:charactersIgnoringModifiers:isARepeat:keyCode:"),
				// 最后两个参数（BOOL isARepeat、unsigned short keyCode）在栈上，arm64 按自然对齐紧挨着放：
				// keyCode 在偏移 2，所以合成一个 8 字节的值传，分开传 keyCode 会读成 0。
				kind, 0.0, 0.0, flags, float64(time.Now().UnixNano())/1e9, num, objc.ID(0), toNSString(chars), toNSString(chars), uint64(codes[key])<<16,
			)
			app.Send(objcSel("sendEvent:"), ev)
		}
	})
}

// lightsXs 是三个按钮的横坐标。
func lightsXs(w objc.ID) [3]float64 {
	var xs [3]float64
	for i := range xs {
		xs[i] = frameOf(objc.Send[objc.ID](w, objcSel("standardWindowButton:"), i)).X
	}
	return xs
}

// resetLights 把三个按钮放回系统默认位置，和系统重新布局标题栏的结果一样。
func resetLights(win *mygo.Window) {
	w := objc.ID(win.NativeHandle())
	xs := lightsXs(w)
	gap := xs[1] - xs[0]
	container := closeButton(w).Send(objcSel("superview")).Send(objcSel("superview"))
	c := frameOf(container)
	objc.Send[objc.ID](container, objcSel("setFrame:"), nsRect{c.X, frameOf(w).H - 32, c.W, 32})
	for i := range xs {
		objc.Send[objc.ID](objc.Send[objc.ID](w, objcSel("standardWindowButton:"), i), objcSel("setFrameOrigin:"), 9+float64(i)*gap, 9.0)
	}
}

// windowShot 让进程拍自己的窗口，拍得到交通灯和系统材质；拍自己的窗口不需要屏幕录制权限。
func windowShot(win *mygo.Window, name string) error {
	lib, err := purego.Dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", purego.RTLD_LAZY)
	if err != nil {
		return err
	}
	sym, err := purego.Dlsym(lib, "CGWindowListCreateImage")
	if err != nil {
		return err
	}
	var create func(bounds nsRect, list uint32, window uint32, opts uint32) uintptr
	purego.RegisterFunc(&create, sym)
	path := filepath.Join(os.Getenv("TODO_SNAP_DIR"), name+".png")
	var shotErr error
	mygo.RunOnMain(func() {
		w := objc.ID(win.NativeHandle())
		const onlyThisWindow, boundsIgnoreFraming = 1 << 3, 1 << 0
		img := create(nsRect{}, onlyThisWindow, uint32(objc.Send[int](w, objcSel("windowNumber"))), boundsIgnoreFraming)
		if img == 0 {
			shotErr = errors.New("CGWindowListCreateImage 返回空")
			return
		}
		rep := objc.ID(objc.GetClass("NSBitmapImageRep")).Send(objcSel("alloc")).Send(objcSel("initWithCGImage:"), img)
		const pngType = 4
		data := rep.Send(objcSel("representationUsingType:properties:"), pngType, objc.ID(objc.GetClass("NSDictionary")).Send(objcSel("dictionary")))
		if !objc.Send[bool](data, objcSel("writeToFile:atomically:"), toNSString(path), true) {
			shotErr = errors.New("写文件失败")
		}
	})
	return shotErr
}

func objcSel(name string) objc.SEL { return objc.RegisterName(name) }

func nsString(id objc.ID) string {
	if id == 0 {
		return ""
	}
	return goString(objc.Send[*byte](id, objcSel("UTF8String")))
}

func toNSString(s string) objc.ID {
	return objc.ID(objc.GetClass("NSString")).Send(objcSel("stringWithUTF8String:"), append([]byte(s), 0))
}

func viewTree(v objc.ID, depth int, b *strings.Builder) {
	fmt.Fprintf(b, "%s%s", strings.Repeat("  ", depth), nsString(v.Send(objcSel("className"))))
	if nsString(v.Send(objcSel("className"))) == "NSGlassEffectView" {
		fmt.Fprintf(b, " style=%d", objc.Send[int](v, objcSel("style")))
	}
	if objc.Send[bool](v, objcSel("respondsToSelector:"), objcSel("_drawsBackground")) {
		fmt.Fprintf(b, " drawsBackground=%v", objc.Send[bool](v, objcSel("_drawsBackground")))
	}
	b.WriteString("\n")
	subs := v.Send(objcSel("subviews"))
	for i := range objc.Send[uint](subs, objcSel("count")) {
		viewTree(subs.Send(objcSel("objectAtIndex:"), i), depth+1, b)
	}
}

func nativeDump(win *mygo.Window) string {
	var b strings.Builder
	mygo.RunOnMain(func() {
		w := objc.ID(win.NativeHandle())
		fmt.Fprintf(&b, "window isOpaque=%v\n", objc.Send[bool](w, objcSel("isOpaque")))
		viewTree(w.Send(objcSel("contentView")), 0, &b)
	})
	// RunOnMain 不等执行完，这里等它写好。
	time.Sleep(200 * time.Millisecond)
	return b.String()
}

func startScript(win *mygo.Window) {
	path := os.Getenv("TODO_SCRIPT")
	if path == "" {
		return
	}
	go runScript(win, path)
}

func runScript(win *mygo.Window, path string) {
	code := 0
	defer func() {
		quitting = true
		flushOnQuit(&Store{})
		mygo.App.Exit(code)
	}()
	fail := func(format string, args ...any) {
		fmt.Printf("[script] 失败 "+format+"\n", args...)
		code = 1
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fail("%v", err)
		return
	}
	var steps []scriptStep
	if err := json.Unmarshal(data, &steps); err != nil {
		fail("%v", err)
		return
	}
	waitFor := func(expr string, seconds int) bool {
		if seconds == 0 {
			seconds = 20
		}
		for deadline := time.Now().Add(time.Duration(seconds) * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
			if ok, err := mygo.EvalAs[bool](win.Page(), expr); err == nil && ok {
				return true
			}
		}
		return false
	}
	if !waitFor("return !!window.__todo", 20) {
		fail("页面没有启动")
		return
	}
	for _, s := range steps {
		switch {
		case s.Sleep > 0:
			time.Sleep(time.Duration(s.Sleep) * time.Millisecond)
		case s.Wait != "":
			if !waitFor(s.Wait, s.Timeout) {
				fail("等待超时 %s", s.Label)
			}
		case s.Native:
			fmt.Print(nativeDump(win))
		case s.Key != "":
			sendKey(win, s.Key)
		case len(s.Hotkeys) > 0:
			for _, h := range s.Hotkeys {
				fmt.Printf("[hotkey] %s registered=%v\n", h, mygo.GlobalShortcut.IsRegistered(h))
			}
			fmt.Printf("[tray] shown=%v\n", tray != nil)
		case s.Lights != "":
			fmt.Print(lightsDump(win, s.Lights))
		case s.Shot != "":
			if err := windowShot(win, s.Shot); err != nil {
				fail("窗口截图 %s: %v", s.Shot, err)
			}
		case s.Win != "":
			mygo.RunOnMain(func() {
				switch s.Win {
				case "hide":
					win.Hide()
				case "show":
					win.Show()
				case "focus":
					win.Focus()
				case "minimize":
					win.Minimize()
				case "restore":
					win.Restore()
				case "maximize":
					win.Maximize()
				case "unmaximize":
					win.Unmaximize()
				case "fullscreen":
					win.SetFullScreen(true)
				case "windowed":
					win.SetFullScreen(false)
				case "reset":
					resetLights(win)
				}
			})
			if s.Win == "away" {
				exec.Command("open", "-a", "Finder").Run()
			}
			if s.Win == "screens" {
				x, y := win.Position()
				for _, d := range mygo.Screen.Displays() {
					mygo.RunOnMain(func() { win.SetPosition(d.WorkArea.X+40, d.WorkArea.Y+40) })
					time.Sleep(700 * time.Millisecond)
					fmt.Print(lightsDump(win, fmt.Sprintf("屏幕x%d", d.Bounds.X)))
				}
				mygo.RunOnMain(func() { win.SetPosition(x, y) })
			}
		case s.Panel != "":
			mygo.RunOnMain(func() {
				if !panel.IsVisible() {
					togglePanel()
				}
			})
			time.Sleep(300 * time.Millisecond)
			v, err := panel.Page().Eval(s.Panel)
			if err != nil {
				fail("%s: %v", s.Label, err)
				continue
			}
			out, _ := json.Marshal(v)
			fmt.Printf("[script] %s = %s\n", s.Label, out)
		case s.PanelSnap != "":
			png, err := panel.CapturePage()
			if err == nil {
				err = os.WriteFile(filepath.Join(os.Getenv("TODO_SNAP_DIR"), s.PanelSnap+".png"), png, 0o644)
			}
			if err != nil {
				fail("截图 %s: %v", s.PanelSnap, err)
			}
		case s.Snap != "":
			png, err := win.CapturePage()
			if err == nil {
				err = os.WriteFile(filepath.Join(os.Getenv("TODO_SNAP_DIR"), s.Snap+".png"), png, 0o644)
			}
			if err != nil {
				fail("截图 %s: %v", s.Snap, err)
			}
		case s.Eval != "":
			v, err := win.Page().Eval(s.Eval)
			if err != nil {
				fail("%s: %v", s.Label, err)
				continue
			}
			out, _ := json.Marshal(v)
			fmt.Printf("[script] %s = %s\n", s.Label, out)
		}
	}
}
