#!/bin/zsh
# 构建 iOS 版。用法：
#   ios.sh sim                构建模拟器版（不签名）
#   ios.sh device [UDID]      构建真机版并装到手机上，默认是唯一连着的 iPhone
set -e
cd "$(dirname "$0")/.."
KIND=${1:-sim}
export PATH="/opt/homebrew/bin:$PATH"
node_modules/.bin/vite build
node_modules/.bin/vite build --config vite.widget.config.ts
(cd ios && xcodegen generate --quiet)
BUILD=ios/build
case $KIND in
  sim)
    xcodebuild -project ios/Todo.xcodeproj -scheme Todo -configuration Debug -sdk iphonesimulator \
      -destination 'generic/platform=iOS Simulator' -derivedDataPath $BUILD \
      ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO -quiet build
    echo "$BUILD/Build/Products/Debug-iphonesimulator/Todo.app"
    ;;
  device)
    UDID=${2:-$(xcrun devicectl list devices 2>/dev/null | awk '/available \(paired\)/ && /iPhone/ && /physical/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) print $i; exit}')}
    [[ -n $UDID ]] || { echo "没有找到连着的 iPhone"; exit 1 }
    xcodebuild -project ios/Todo.xcodeproj -scheme Todo -configuration Debug \
      -destination "id=$UDID" -derivedDataPath $BUILD -allowProvisioningUpdates -allowProvisioningDeviceRegistration -quiet build
    APP=$BUILD/Build/Products/Debug-iphoneos/Todo.app
    xcrun devicectl device install app --device "$UDID" "$APP"
    xcrun devicectl device process launch --device "$UDID" com.rppig42.todo || true
    ;;
  *)
    echo "未知类型 $KIND"
    exit 1
    ;;
esac
