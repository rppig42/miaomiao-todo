package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

const (
	stateFile   = "state.json"
	backupDir   = "backups"
	backupsKept = 14
)

// Store 把页面的状态存成文件。合并规则都在页面里，这里只管可靠地落盘。
// iCloud 是同步通道，本地这份让 App 离线、没登录、空间满的时候都照常能用。
type Store struct {
	mu sync.Mutex
}

// dataDir 是数据目录；TODO_DATA_DIR 用来在测试时和真实数据隔开。
func dataDir() (string, error) {
	dir := os.Getenv("TODO_DATA_DIR")
	if dir == "" {
		// 用 Bundle ID 而不是 App 名字：以后改名不会找不到数据。
		base, err := mygo.App.Path(mygo.PathAppData)
		if err != nil {
			return "", err
		}
		dir = filepath.Join(base, "com.rppig42.todo")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// Load 返回保存的状态，还没有数据时返回空字符串。
func (s *Store) Load() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(dir, stateFile))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	return string(data), err
}

// Save 保存状态。先写临时文件再改名，断电或崩溃也不会留下写了一半的文件。
func (s *Store) Save(data string) error {
	if !json.Valid([]byte(data)) {
		return errors.New("状态不是合法的 JSON，没有保存")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := dataDir()
	if err != nil {
		return err
	}
	if err := backupOncePerDay(dir, time.Now()); err != nil {
		return fmt.Errorf("备份失败：%w", err)
	}
	return writeAtomic(filepath.Join(dir, stateFile), []byte(data), 0o600)
}

func writeAtomic(path string, data []byte, perm fs.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // 改名成功后这里什么也不会删
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// backupOncePerDay 每天第一次保存前留一份旧数据，保留最近 14 份。
func backupOncePerDay(dir string, now time.Time) error {
	current, err := os.ReadFile(filepath.Join(dir, stateFile))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	backups := filepath.Join(dir, backupDir)
	if err := os.MkdirAll(backups, 0o700); err != nil {
		return err
	}
	target := filepath.Join(backups, "state-"+now.Format("2006-01-02")+".json")
	if _, err := os.Stat(target); err == nil {
		return nil
	}
	if err := writeAtomic(target, current, 0o600); err != nil {
		return err
	}
	entries, err := filepath.Glob(filepath.Join(backups, "state-*.json"))
	if err != nil {
		return err
	}
	sort.Strings(entries)
	for len(entries) > backupsKept {
		_ = os.Remove(entries[0])
		entries = entries[1:]
	}
	return nil
}
