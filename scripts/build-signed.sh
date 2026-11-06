#!/bin/zsh
# 打可以连 iCloud 的调试包（不做 DMG、不公证）。mygo dev 是 ad-hoc 签名，连不了 iCloud。
# 用法：build-signed.sh [development|developer-id]，默认 development（连 CloudKit 开发环境）。
set -e
cd "$(dirname "$0")/.."
export PATH=$(ls -d ~/go/pkg/mod/golang.org/toolchain@*1.27.3*/bin):$PATH GOFLAGS=-buildvcs=false
KIND=${1:-development}
case $KIND in
  development) ID="Apple Development: Pengpeng Ren (7ZL888X86G)" ;;
  developer-id) ID="Developer ID Application: Pengpeng Ren (9PGVRX5XJ2)" ;;
  *) echo "未知类型 $KIND"; exit 1 ;;
esac
sh scripts/build-native.sh arm64
OUT=build/signed-$KIND
go tool mygo build -debug -skip-dmg -skip-notarize -platform darwin/arm64 -o "$OUT" -sign "$ID" ${SKIP_WEB:+-skip-build-command}
APP="$OUT/darwin-arm64/$(node -p "JSON.parse(require('fs').readFileSync('mygo.json','utf8')).name").app"
cp "signing/$KIND.provisionprofile" "$APP/Contents/embedded.provisionprofile"
codesign --force --options runtime --timestamp=none --sign "$ID" --entitlements "signing/$KIND.entitlements" "$APP"
codesign --verify --strict "$APP"
echo "$APP"
