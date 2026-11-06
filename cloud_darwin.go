package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
	"github.com/egoist/mygo"
)

// CloudEvent 把同步层的事件原样转给页面，内容是 JSON。见 native/CloudSync.swift 的 emit。
var CloudEvent = mygo.NewEvent[string]("cloud")

// Cloud 是页面和 iCloud 同步层之间的通道。mygo dev 是 ad-hoc 签名，没有 iCloud 权限，
// 这时 Available 返回 false，页面只用本地存储。
type Cloud struct{}

// cloudLib 是 native/ 编出来的 Swift 动态库。
type cloudLib struct {
	available func() int32
	start     func(string, uintptr)
	push      func(string)
	fetch     func()
	send      func()
	flush     func()
	pending   func() int32
	selftest  func(uintptr)
	resetDev  func(uintptr)
}

var (
	cloudOnce  sync.Once
	cloudInst  *cloudLib
	cloudErr   error
	cloudStart sync.Once
)

func loadCloud() (*cloudLib, error) {
	cloudOnce.Do(func() {
		dir, err := mygo.App.Path(mygo.PathResources)
		if err != nil {
			cloudErr = err
			return
		}
		h, err := purego.Dlopen(filepath.Join(dir, "libcloudsync.dylib"), purego.RTLD_NOW|purego.RTLD_LOCAL)
		if err != nil {
			cloudErr = errors.New("加载同步层失败: " + err.Error())
			return
		}
		l := &cloudLib{}
		purego.RegisterLibFunc(&l.available, h, "cs_available")
		purego.RegisterLibFunc(&l.start, h, "cs_start")
		purego.RegisterLibFunc(&l.push, h, "cs_push")
		purego.RegisterLibFunc(&l.fetch, h, "cs_fetch")
		purego.RegisterLibFunc(&l.send, h, "cs_send")
		purego.RegisterLibFunc(&l.flush, h, "cs_flush")
		purego.RegisterLibFunc(&l.pending, h, "cs_pending")
		purego.RegisterLibFunc(&l.selftest, h, "cs_selftest")
		purego.RegisterLibFunc(&l.resetDev, h, "cs_reset_dev")
		cloudInst = l
	})
	return cloudInst, cloudErr
}

func readyCloud() *cloudLib {
	l, err := loadCloud()
	if err != nil || l.available() == 0 {
		return nil
	}
	return l
}

// Available 报告这个包能不能连 iCloud。
func (Cloud) Available() bool { return readyCloud() != nil }

// Start 启动同步。页面准备好接收事件后调用，只有第一次有效。
func (Cloud) Start() error {
	l := readyCloud()
	if l == nil {
		return nil
	}
	dir, err := dataDir()
	if err != nil {
		return err
	}
	cloudStart.Do(func() {
		cb := purego.NewCallback(func(p *byte) uintptr {
			CloudEvent.Broadcast(goString(p))
			return 0
		})
		l.start(dir, cb)
		go pollCloud(l)
	})
	return nil
}

// Push 把文档交给同步层。上传失败时它会自己重试，下次启动也会接着传。
func (Cloud) Push(items string) {
	if l := readyCloud(); l != nil {
		l.push(items)
	}
}

// Fetch 立刻查一次云端。
func (Cloud) Fetch() {
	if l := readyCloud(); l != nil {
		l.fetch()
		l.send()
	}
}

// 变更推送不一定总能到，隔一段时间主动查一次。
func pollCloud(l *cloudLib) {
	for range time.Tick(2 * time.Minute) {
		l.fetch()
	}
}

// flushCloud 在退出前尽量把没传完的内容发出去，最多等 1.5 秒。
// 没发完也不要紧：内容已经落盘，下次启动会接着传。
func flushCloud() {
	if cloudInst == nil || cloudInst.available() == 0 {
		return
	}
	if cloudInst.pending() > 0 {
		cloudInst.send()
		for deadline := time.Now().Add(1500 * time.Millisecond); cloudInst.pending() > 0 && time.Now().Before(deadline); {
			time.Sleep(100 * time.Millisecond)
		}
	}
	cloudInst.flush()
}

func goString(p *byte) string {
	if p == nil {
		return ""
	}
	n := 0
	for *(*byte)(unsafe.Add(unsafe.Pointer(p), n)) != 0 {
		n++
	}
	return string(unsafe.Slice(p, n))
}

// cloudSelfTest 是 --cloud-selftest：在单独的存储区里读写一条，不碰正式数据。
func cloudSelfTest() { runCloudTool(func(l *cloudLib, cb uintptr) { l.selftest(cb) }) }

// cloudResetDev 是 --cloud-reset-dev：清空开发环境的存储区，生产环境的包什么也不做。
func cloudResetDev() { runCloudTool(func(l *cloudLib, cb uintptr) { l.resetDev(cb) }) }

func runCloudTool(run func(*cloudLib, uintptr)) {
	l, err := loadCloud()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	done := make(chan struct{})
	cb := purego.NewCallback(func(p *byte) uintptr {
		s := goString(p)
		if s == "END" {
			close(done)
		} else {
			fmt.Println(s)
		}
		return 0
	})
	run(l, cb)
	select {
	case <-done:
	case <-time.After(60 * time.Second):
		fmt.Println("timeout")
	}
	os.Exit(0)
}
