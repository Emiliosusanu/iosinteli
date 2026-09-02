#!/usr/bin/env bash
# Hard QA: capture InteliAds device logs while driving screens via deep-link relaunches + screenshots.
set -euo pipefail

UDID="${1:-00008120-001210563E6BC01E}"
BUNDLE="io.inteliads.app"
OUT="/tmp/inteliads-hard-qa-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT/screens" "$OUT/logs"
export PYMOBILEDEVICE3_UDID="$UDID"

echo "OUT=$OUT"

# Resolve InteliAds PID (may be empty if not running)
PID=$(pymobiledevice3 developer dvt process-id-for-bundle-id "$BUNDLE" --udid "$UDID" 2>/dev/null | tail -1 | tr -d '[:space:]' || true)
echo "PID=${PID:-none}" | tee "$OUT/logs/meta.txt"

# Broad + app-focused syslog captures
pymobiledevice3 syslog live --udid "$UDID" \
  --insensitive-regex 'inteliads|InteliAds|ReactNative|Expo|HOME_QUERY_TIMEOUT|BooksReadError|AbortError|TypeError|Unhandled|RedBox|console\.error|\[inteliads:' \
  --out "$OUT/logs/app-filtered.log" >/dev/null 2>"$OUT/logs/syslog-filtered.err" &
SYSLOG_PID=$!

# Full process filter if we have a pid
if [[ -n "${PID:-}" && "$PID" =~ ^[0-9]+$ ]]; then
  pymobiledevice3 syslog live --udid "$UDID" --pid "$PID" \
    --out "$OUT/logs/pid-${PID}.log" >/dev/null 2>"$OUT/logs/syslog-pid.err" &
  SYSLOG_PID2=$!
else
  SYSLOG_PID2=""
fi

cleanup() {
  kill "$SYSLOG_PID" ${SYSLOG_PID2:-} 2>/dev/null || true
}
trap cleanup EXIT

shot() {
  local name="$1"
  pymobiledevice3 developer dvt screenshot "$OUT/screens/${name}.png" --udid "$UDID" >/dev/null 2>&1 || \
    PYTHONUNBUFFERED=1 /tmp/pymobile-venv/bin/python - <<PY
import asyncio
from pathlib import Path
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.screenshot import ScreenshotService
async def main():
    ld = await create_using_usbmux(serial="$UDID")
    async with ScreenshotService(lockdown=ld) as sc:
        data = await sc.take_screenshot()
        Path("$OUT/screens/${name}.png").write_bytes(data)
        print("shot ${name}", len(data))
asyncio.run(main())
PY
}

launch_url() {
  local path="$1"
  local label="$2"
  echo "==> $label ($path)" | tee -a "$OUT/logs/steps.txt"
  # Relaunch with Expo deep link env (best-effort) + URL argument
  pymobiledevice3 developer dvt launch "$BUNDLE" \
    --udid "$UDID" \
    --kill-existing \
    --env "EXPO_ROUTER_INITIAL_URL=${path}" \
    --env "RCT_METRO_PORT=8081" \
    "inteliads://${path#/}" 2>>"$OUT/logs/launch.err" | tee -a "$OUT/logs/steps.txt" || true
  sleep 3
  shot "$label"
}

# Cold start Overview
launch_url "/" "01-overview"
sleep 2
shot "01b-overview-settle"

# Tab deep links
launch_url "/(tabs)/campaigns" "02-campaigns"
sleep 4
shot "02b-campaigns-settle"

launch_url "/(tabs)/targeting" "03-targets"
sleep 5
shot "03b-targets-settle"

launch_url "/(tabs)/products" "04-books"
sleep 4
shot "04b-books-settle"

launch_url "/(tabs)/more" "05-more"
sleep 2
shot "05b-more-settle"

# More sub-screens
launch_url "/more/settings" "06-settings"
sleep 2
shot "06b-settings"

launch_url "/more/accounts" "07-accounts"
sleep 2
shot "07b-accounts"

launch_url "/more/bid-bot" "08-bidbot"
sleep 3
shot "08b-bidbot"

launch_url "/more/rule-history" "09-rule-history"
sleep 2
shot "09b-rule-history"

launch_url "/more/negative-targeting" "10-negatives"
sleep 2
shot "10b-negatives"

launch_url "/more/sync" "11-sync"
sleep 2
shot "11b-sync"

# Back to overview + targets stress (date-sensitive)
launch_url "/(tabs)" "12-overview-return"
sleep 3
shot "12b-overview-return"
launch_url "/(tabs)/targeting" "13-targets-again"
sleep 8
shot "13b-targets-again"

# Summarize logs
echo "==> Log summary" | tee -a "$OUT/logs/steps.txt"
sleep 2
rg -n "HOME_QUERY_TIMEOUT|BooksReadError|\[inteliads:perf\]|Unhandled|TypeError|RedBox|Couldn't load|INCOMPLETE_READ|AbortError|error" \
  "$OUT/logs/app-filtered.log" 2>/dev/null | tee "$OUT/logs/hits.txt" | tail -80 || true

wc -l "$OUT/logs"/* 2>/dev/null | tee -a "$OUT/logs/meta.txt"
ls -la "$OUT/screens" | tee -a "$OUT/logs/meta.txt"
echo "DONE $OUT"
