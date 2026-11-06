#!/bin/zsh
# 打发布用的 DMG：Intel 和 Apple 芯片通用，Developer ID 签名，连 CloudKit 生产环境，公证并装订。
# 需要钥匙串里的 Developer ID 证书，以及 notarytool 存好的凭据（NOTARY_PROFILE）。
# mygo.json 里不写权限和描述文件（mygo dev 会因此启动失败），所以这里先构建、再补签。
set -e
cd "$(dirname "$0")/.."
export PATH=$(ls -d ~/go/pkg/mod/golang.org/toolchain@*1.27.3*/bin):$PATH GOFLAGS=-buildvcs=false
ID=${SIGN_ID:-"Developer ID Application: Pengpeng Ren (9PGVRX5XJ2)"}
NOTARY_PROFILE=${NOTARY_PROFILE:-rppig42-notary}
NAME=$(node -p "require('./mygo.json').name")
VERSION=$(node -p "require('./mygo.json').version")
OUT=build/release
rm -rf $OUT

sh scripts/build-native.sh all
go tool mygo build -platform darwin/universal -skip-dmg -skip-notarize -sign "$ID" -o $OUT
APP=$(find $OUT -maxdepth 2 -name "$NAME.app" | head -1)
cp signing/developer-id.provisionprofile "$APP/Contents/embedded.provisionprofile"
codesign --force --options runtime --timestamp --sign "$ID" --entitlements signing/developer-id.entitlements "$APP"
codesign --verify --strict --deep "$APP"

# 文件名用英文：GitHub 会把附件名里的中文换成点。
DMG=$OUT/miaomiao-todo-$VERSION.dmg
STAGE=$OUT/dmg
mkdir -p $STAGE
ditto "$APP" "$STAGE/$NAME.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "$NAME" -srcfolder $STAGE -ov -format UDZO "$DMG"
codesign --sign "$ID" --timestamp "$DMG"

xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature -v "$DMG"
echo "$DMG"
