#!/bin/sh
# Build, sign and install the patched all-ages test app.   android/build.sh [--dev] [--no-install]
# Run from anywhere; paths with Japanese characters go through the scratchpad because adb can't read them.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${GGXEN_WORK:?set GGXEN_WORK to an ASCII-only scratch folder}"
APK="${GGXEN_APK:-$HERE/apk/gg-1.0.75-89/base.apk}"
DEV=""; INSTALL=1
for a in "$@"; do case "$a" in --dev) DEV="--dev";; --no-install) INSTALL=0;; esac; done
(cd "$HERE/agent" && npm run build --silent)
rm -f "$WORK/patched-unsigned.apk"
"$HERE/.venv/Scripts/python" -I "$HERE/patch_apk.py" $DEV "$APK" "$WORK/patched-unsigned.apk" | tail -1
JAVA="/c/Program Files/Java/jre1.8.0_461/bin/java"
PASS="$(cat "$HERE/keys/keystore-pass.txt")"
cp "$HERE/keys/ggxen.jks" "$WORK/ggxen.jks"
rm -rf "$WORK/signed"
"$JAVA" -jar "$HERE/tools/uber-apk-signer-1.3.0.jar" -a "$WORK/patched-unsigned.apk" --ks "$WORK/ggxen.jks" \
  --ksAlias ggxen --ksPass "$PASS" --ksKeyPass "$PASS" --allowResign -o "$WORK/signed" | grep -E "Successfully|ERROR" || true
rm -f "$WORK/ggxen.jks"
if [ "$INSTALL" = 1 ]; then
  ADB="$(ls /c/Users/*/AppData/Local/Microsoft/WinGet/Packages/Google.PlatformTools_*/platform-tools/adb.exe | head -1)"
  "$ADB" install -r "$(ls "$WORK"/signed/*.apk | head -1)" | tail -1
fi
