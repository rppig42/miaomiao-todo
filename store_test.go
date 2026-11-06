package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSaveLoad(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TODO_DATA_DIR", dir)
	s := &Store{}
	if got, err := s.Load(); err != nil || got != "" {
		t.Fatalf("空目录应该读到空字符串，得到 %q, %v", got, err)
	}
	if err := s.Save(`{"docs":[]}`); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Load(); got != `{"docs":[]}` {
		t.Fatalf("读回 %q", got)
	}
	if err := s.Save("不是 JSON"); err == nil {
		t.Fatal("非法内容应该被拒绝")
	}
	if got, _ := s.Load(); got != `{"docs":[]}` {
		t.Fatalf("保存失败后原文件被改了: %q", got)
	}
	if leftovers, _ := filepath.Glob(filepath.Join(dir, ".tmp-*")); len(leftovers) != 0 {
		t.Fatalf("留下了临时文件 %v", leftovers)
	}
}

func TestBackupOncePerDayKeepsFourteen(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, stateFile), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, 11, 1, 9, 0, 0, 0, time.Local)
	for i := range 20 {
		for range 2 { // 同一天保存两次只备份一份
			if err := backupOncePerDay(dir, day.AddDate(0, 0, i)); err != nil {
				t.Fatal(err)
			}
		}
	}
	files, _ := filepath.Glob(filepath.Join(dir, backupDir, "state-*.json"))
	if len(files) != backupsKept {
		t.Fatalf("应该留 %d 份，实际 %d 份", backupsKept, len(files))
	}
	if filepath.Base(files[len(files)-1]) != "state-2026-11-20.json" {
		t.Fatalf("最新的备份不对: %s", files[len(files)-1])
	}
}

func TestDeviceDefaults(t *testing.T) {
	t.Setenv("TODO_DATA_DIR", t.TempDir())
	if got := loadDevice(); got != defaultDevice() {
		t.Fatalf("没有文件时应该是默认值，得到 %+v", got)
	}
}

func TestDeviceSaveLoad(t *testing.T) {
	t.Setenv("TODO_DATA_DIR", t.TempDir())
	want := defaultDevice()
	want.Theme, want.QuickAdd, want.ToggleWindow, want.Tray = "dark", "", "Cmd+Shift+K", false
	if err := saveDevice(want); err != nil {
		t.Fatal(err)
	}
	if got := loadDevice(); got != want {
		t.Fatalf("得到 %+v，想要 %+v", got, want)
	}
}

func TestDeviceMissingFieldsKeepDefaults(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TODO_DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, deviceFile), []byte(`{"theme":"light"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	got := loadDevice()
	want := defaultDevice()
	want.Theme = "light"
	if got != want {
		t.Fatalf("得到 %+v，想要 %+v", got, want)
	}
}

func TestDeviceUnknownThemeFollowsSystem(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TODO_DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, deviceFile), []byte(`{"theme":"blue"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := loadDevice().Theme; got != "system" {
		t.Fatalf("得到 %q", got)
	}
}

func TestDeviceCorruptFileFallsBack(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TODO_DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, deviceFile), []byte(`{"theme":"dark","tray":`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := loadDevice(); got != defaultDevice() {
		t.Fatalf("文件坏了应该回到默认值，得到 %+v", got)
	}
}
