#!/bin/sh
# 把 native/ 里的 Swift 同步层编成动态库，放进 MyGo 的平台资源目录。
# 用法：build-native.sh [arm64|x86_64|all]，默认只编本机架构。
set -e
cd "$(dirname "$0")/.."
SDK=$(xcrun --sdk macosx --show-sdk-path)
one() {
  arch=$1; dir=$2
  mkdir -p "resources/$dir"
  out="resources/$dir/libcloudsync.dylib"
  if [ -f "$out" ] && [ -z "$(find native -name '*.swift' -newer "$out" | head -1)" ]; then return; fi
  xcrun --sdk macosx swiftc -emit-library -module-name CloudSync -O -swift-version 5 \
    -target "$arch-apple-macos14" -sdk "$SDK" native/*.swift -o "$out" \
    -Xlinker -install_name -Xlinker @rpath/libcloudsync.dylib
}
case "${1:-arm64}" in
  arm64) one arm64 darwin-arm64 ;;
  x86_64) one x86_64 darwin-amd64 ;;
  all) one arm64 darwin-arm64; one x86_64 darwin-amd64 ;;
esac
