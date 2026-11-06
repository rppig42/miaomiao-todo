package main

import (
	"sync/atomic"
	"time"

	"github.com/ebitengine/purego/objc"
	"github.com/egoist/mygo"
)

// lightsInset 是关闭按钮左上角到窗口左上角的距离。
// 窗口内边距 8 加侧栏圆角 18，圆角的圆心在 26；按钮直径 14，放在 19 就和圆角同心。
const lightsInset = 19

// lightsSettle 是按钮停稳多久之后才判断要不要放回去。
const lightsSettle = 300 * time.Millisecond

// lightsHealed 记录放回去过几次，只给调试脚本看。
var lightsHealed atomic.Int32

func frameOf(v objc.ID) nsRect { return objc.Send[nsRect](v, objcSel("frame")) }

func closeButton(w objc.ID) objc.ID {
	return objc.Send[objc.ID](w, objcSel("standardWindowButton:"), 0)
}

// lightsMisplaced 判断交通灯是不是被挪走了。全屏时按钮搬到了别的视图里，归系统管。
func lightsMisplaced(w objc.ID) bool {
	btn := closeButton(w)
	if btn == 0 {
		return false
	}
	container := btn.Send(objcSel("superview")).Send(objcSel("superview"))
	if container == 0 || container.Send(objcSel("superview")) != w.Send(objcSel("contentView")).Send(objcSel("superview")) {
		return false
	}
	b := frameOf(btn)
	return b.X != lightsInset || b.Y != lightsInset || frameOf(container).H != b.H+2*lightsInset
}

// keepTrafficLights 让交通灯一直待在 lightsInset。
//
// MyGo 的 TrafficLightPosition 只在改大小、改标题、切外观和退出全屏时重排。系统在别的时候
// 重新布局标题栏，按钮就回到默认的 (9, 9)，骑在侧栏的圆角上，而且一直回不来。
// 所以盯着按钮和它的容器，一被挪动就放回去。
func keepTrafficLights(win *mygo.Window) {
	w := objc.ID(win.NativeHandle())
	heal := func() {
		if win.IsFullScreen() || !lightsMisplaced(w) {
			return
		}
		lightsHealed.Add(1)
		// MyGo 没有单独重排的接口，SetTitle 会顺带重排，标题不变。
		win.SetTitle(win.Title())
	}

	// 不马上动：进出全屏时系统也会挪按钮，这时插手可能打断全屏动画。等它停稳再看。
	// 只在主线程上用。
	var timer *time.Timer
	schedule := func() {
		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(lightsSettle, func() { mygo.RunOnMain(heal) })
	}
	// 不限定 object：系统可能换掉按钮，盯某一个实例会漏掉。
	block := objc.NewBlock(func(_ objc.Block, note objc.ID) {
		v := note.Send(objcSel("object"))
		btn := closeButton(w)
		if btn != 0 && (v == btn || v == btn.Send(objcSel("superview")).Send(objcSel("superview"))) {
			schedule()
		}
	})
	objc.ID(objc.GetClass("NSNotificationCenter")).Send(objcSel("defaultCenter")).Send(
		objcSel("addObserverForName:object:queue:usingBlock:"),
		toNSString("NSViewFrameDidChangeNotification"), objc.ID(0), objc.ID(0), block,
	)
	// 万一哪次没有发通知，回到窗口时也能修好。
	win.OnFocus(schedule)
}
