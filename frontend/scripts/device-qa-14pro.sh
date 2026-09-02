#!/usr/bin/env bash
# Install Release build on iPhone 14 Pro and capture perf/syslog for QA.
set -euo pipefail

UDID="${1:-00008120-001210563E6BC01E}"
APP="${2:-/tmp/InteliAds-DD-14Pro-Signed/Build/Products/Release-iphoneos/InteliAds.app}"
BUNDLE_ID="io.inteliads.app"
LOG="/tmp/inteliads-14pro-qa-$(date +%Y%m%d-%H%M%S).log"

if [[ ! -d "$APP" ]]; then
  echo "Missing app bundle: $APP" >&2
  exit 1
fi

echo "==> Device"
pymobiledevice3 usbmux list | rg "$UDID|DeviceName" || true

echo "==> Install $APP"
pymobiledevice3 apps install "$APP" --udid "$UDID"

echo "==> Launch $BUNDLE_ID (capture 90s)"
pymobiledevice3 developer dvt launch "$BUNDLE_ID" --udid "$UDID" 2>&1 | tee "$LOG" &
LAUNCH_PID=$!

sleep 90
kill "$LAUNCH_PID" 2>/dev/null || true

echo "==> Perf / error summary"
rg "\[inteliads:(perf|data)\]|HOME_QUERY_TIMEOUT|BooksReadError|Couldn't load" "$LOG" || echo "(no perf lines in launch output)"

if command -v pymobiledevice3 >/dev/null; then
  echo "==> Recent crash reports (if any)"
  pymobiledevice3 crash list --udid "$UDID" 2>/dev/null | head -5 || true
fi

echo "Log saved: $LOG"
