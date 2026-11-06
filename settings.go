package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
)

const deviceFile = "device.json"

// DeviceSettings 是只属于这台 Mac 的设置，不走 iCloud：快捷键按键盘和习惯来，
// 外观和菜单栏图标各台机器也可以不一样。跟着账号走的设置在 src/core/settings.ts。
type DeviceSettings struct {
	// Theme 是外观：system、light、dark。
	Theme string `json:"theme"`
	// QuickAdd 是呼出快速添加面板的全局快捷键，空字符串表示不用。
	QuickAdd string `json:"quickAdd"`
	// ToggleWindow 是显示或隐藏主窗口的全局快捷键。
	ToggleWindow string `json:"toggleWindow"`
	// AddTask 是窗口里添加任务的快捷键，放在菜单上。
	AddTask string `json:"addTask"`
	// Tray 是要不要显示菜单栏图标。
	Tray bool `json:"tray"`
	// Badge 是要不要在 Dock 图标上显示今天的待办数。
	Badge bool `json:"badge"`
	// OpenAtLogin 以系统登录项为准，用户可能在系统设置里改过，所以不存文件。
	OpenAtLogin bool `json:"openAtLogin"`
}

func defaultDevice() DeviceSettings {
	return DeviceSettings{Theme: "system", QuickAdd: "Ctrl+Alt+Space", AddTask: "Cmd+N", Tray: true, Badge: true}
}

// loadDevice 读设置，文件里没有的字段用默认值。读不出来不影响使用，按默认值启动。
func loadDevice() DeviceSettings {
	d := defaultDevice()
	dir, err := dataDir()
	if err != nil {
		log.Println("设置:", err)
		return d
	}
	data, err := os.ReadFile(filepath.Join(dir, deviceFile))
	if errors.Is(err, fs.ErrNotExist) {
		return d
	}
	if err == nil {
		err = json.Unmarshal(data, &d)
	}
	if err != nil {
		log.Println("设置:", err)
		return defaultDevice()
	}
	switch mygo.ThemeSource(d.Theme) {
	case mygo.ThemeSystem, mygo.ThemeLight, mygo.ThemeDark:
	default:
		d.Theme = "system"
	}
	return d
}

func saveDevice(d DeviceSettings) error {
	dir, err := dataDir()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(dir, deviceFile), data, 0o600)
}

// isolated 表示在用临时数据目录跑测试，这时不能动系统的登录项。
func isolated() bool { return os.Getenv("TODO_DATA_DIR") != "" }

// Settings 是页面读写这台 Mac 上的设置的入口。
type Settings struct {
	mu    sync.Mutex
	v     DeviceSettings
	badge int
	// keys 让注册和注销一组一组地进行，否则恢复全局快捷键时可能把刚换掉的旧快捷键又注册回去。
	keys sync.Mutex
}

var settings = &Settings{}

func (s *Settings) current() DeviceSettings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.v
}

// update 改一项设置并存盘。存不下来也生效，只是下次启动会回到旧值，所以要告诉页面。
func (s *Settings) update(fn func(*DeviceSettings)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.v)
	if err := saveDevice(s.v); err != nil {
		return fmt.Errorf("设置没能保存：%w", err)
	}
	return nil
}

// globalAction 是全局快捷键要做的事。
func globalAction(name string) func() {
	if name == "quickAdd" {
		return togglePanel
	}
	return toggleMain
}

// globals 是当前的两个全局快捷键。
func globals(d DeviceSettings) map[string]string {
	return map[string]string{"quickAdd": d.QuickAdd, "toggleWindow": d.ToggleWindow}
}

// registerGlobals 注册还没注册的全局快捷键。
func registerGlobals(d DeviceSettings) {
	for name, accel := range globals(d) {
		if accel == "" || mygo.GlobalShortcut.IsRegistered(accel) {
			continue
		}
		if err := mygo.GlobalShortcut.Register(accel, globalAction(name)); err != nil {
			log.Println("快捷键:", accel, err)
		}
	}
}

// Get 返回当前设置。
func (s *Settings) Get() DeviceSettings {
	d := s.current()
	if !isolated() {
		d.OpenAtLogin = mygo.App.OpenAtLogin()
	}
	return d
}

// SetTheme 切换外观，所有窗口立刻生效。
func (s *Settings) SetTheme(theme string) error {
	switch mygo.ThemeSource(theme) {
	case mygo.ThemeSystem, mygo.ThemeLight, mygo.ThemeDark:
	default:
		return fmt.Errorf("未知的外观 %q", theme)
	}
	mygo.Theme.SetSource(mygo.ThemeSource(theme))
	return s.update(func(d *DeviceSettings) { d.Theme = theme })
}

// SetTray 显示或隐藏菜单栏图标。
func (s *Settings) SetTray(on bool) error {
	err := s.update(func(d *DeviceSettings) { d.Tray = on })
	mygo.RunOnMain(func() { showTray(on) })
	return err
}

// SetBadge 打开或关闭 Dock 图标上的数字。
func (s *Settings) SetBadge(on bool) error {
	err := s.update(func(d *DeviceSettings) { d.Badge = on })
	s.applyBadge()
	return err
}

// showBadgeCount 记下今天的待办数，打开开关时不用等页面再发一次。
func (s *Settings) showBadgeCount(n int) {
	s.mu.Lock()
	s.badge = n
	s.mu.Unlock()
	s.applyBadge()
}

func (s *Settings) applyBadge() {
	s.mu.Lock()
	n := s.badge
	if !s.v.Badge {
		n = 0
	}
	s.mu.Unlock()
	mygo.App.SetBadgeCount(n)
}

// SetOpenAtLogin 让 App 随系统登录启动，或者取消。
func (s *Settings) SetOpenAtLogin(on bool) error {
	if isolated() {
		return s.update(func(d *DeviceSettings) { d.OpenAtLogin = on })
	}
	if err := mygo.App.SetOpenAtLogin(on); err != nil {
		log.Println("开机启动:", err)
		return errors.New("系统没有允许开机启动")
	}
	return nil
}

// PauseShortcuts 在录制快捷键时停用全局快捷键，否则按到现有的组合会弹出面板，页面收不到按键。
func (s *Settings) PauseShortcuts(paused bool) {
	s.keys.Lock()
	defer s.keys.Unlock()
	d := s.current()
	if !paused {
		registerGlobals(d)
		return
	}
	for _, accel := range globals(d) {
		if accel != "" {
			mygo.GlobalShortcut.Unregister(accel)
		}
	}
}

// SetShortcut 改一个快捷键，空字符串表示不用。系统不让注册时保持原来的，并返回错误。
func (s *Settings) SetShortcut(name, accel string) error {
	s.keys.Lock()
	defer s.keys.Unlock()
	d := s.current()
	switch name {
	case "quickAdd", "toggleWindow":
		old := globals(d)[name]
		if old != "" {
			mygo.GlobalShortcut.Unregister(old)
		}
		if accel != "" {
			if err := mygo.GlobalShortcut.Register(accel, globalAction(name)); err != nil {
				log.Println("快捷键:", accel, err)
				if old != "" {
					_ = mygo.GlobalShortcut.Register(old, globalAction(name))
				}
				return errors.New("系统不允许用这个快捷键")
			}
		}
		err := s.update(func(d *DeviceSettings) {
			if name == "quickAdd" {
				d.QuickAdd = accel
			} else {
				d.ToggleWindow = accel
			}
		})
		mygo.RunOnMain(refreshTrayMenu)
		return err
	case "addTask":
		err := s.update(func(d *DeviceSettings) { d.AddTask = accel })
		mygo.App.SetMenu(appMenu())
		return err
	}
	return fmt.Errorf("未知的快捷键 %q", name)
}

// ResetShortcuts 把快捷键恢复成默认的，返回新的设置。
func (s *Settings) ResetShortcuts() (DeviceSettings, error) {
	def := defaultDevice()
	// 先放开“显示或隐藏窗口”：它可能正占着快速添加的默认快捷键。
	for _, x := range []struct{ name, accel string }{{"toggleWindow", def.ToggleWindow}, {"quickAdd", def.QuickAdd}, {"addTask", def.AddTask}} {
		if err := s.SetShortcut(x.name, x.accel); err != nil {
			return s.Get(), err
		}
	}
	return s.Get(), nil
}
