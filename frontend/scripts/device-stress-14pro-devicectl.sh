#!/usr/bin/env bash
# Device stress without pymobiledevice3 (broken on Homebrew Python 3.14 / pyexpat).
# Uses xcrun devicectl + idevicesyslog. Covers tab launches, deep routes, JS error scan.
set -euo pipefail

UDID="${1:-00008120-001210563E6BC01E}"
BUNDLE="io.inteliads.app"
OUT="${STRESS_DEVICE_OUT:-/tmp/inteliads-14pro-stress-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT/logs"
echo "$OUT" > /tmp/inteliads-14pro-stress-latest.path
echo "OUT=$OUT UDID=$UDID"

launch() {
  local env_json="${1:-}"
  if [[ -n "$env_json" ]]; then
    xcrun devicectl device process launch \
      --device "$UDID" \
      --terminate-existing \
      --environment-variables "$env_json" \
      "$BUNDLE" >/dev/null
  else
    xcrun devicectl device process launch \
      --device "$UDID" \
      --terminate-existing \
      "$BUNDLE" >/dev/null
  fi
}

# Version
xcrun devicectl device info apps --device "$UDID" 2>/dev/null \
  | rg -i "inteliads|io\.inteliads\.app" | tee "$OUT/logs/version.txt" || true

# Syslog (JS + app signals only)
idevicesyslog -u "$UDID" 2>"$OUT/logs/syslog.err" \
  | rg -i --line-buffered 'InteliAds\[|ReactNativeJS|\[inteliads|TypeError|Unhandled|Invariant|bulkOutbox|BooksReadError|HOME_QUERY|Amazon rejected|Writing to Amazon|period metrics|Couldn.?t load' \
  > "$OUT/logs/signals.log" &
SP=$!
trap 'kill $SP 2>/dev/null || true' EXIT

settle() { sleep "${1:-6}"; }

echo "==> home" | tee -a "$OUT/logs/steps.txt"
launch
settle 8

echo "==> campaigns" | tee -a "$OUT/logs/steps.txt"
launch '{"EXPO_ROUTER_INITIAL_URL":"/(tabs)/campaigns"}'
settle 7

echo "==> targeting" | tee -a "$OUT/logs/steps.txt"
launch '{"EXPO_ROUTER_INITIAL_URL":"/(tabs)/targeting"}'
settle 8

echo "==> products/books" | tee -a "$OUT/logs/steps.txt"
launch '{"EXPO_ROUTER_INITIAL_URL":"/(tabs)/products"}'
settle 7

echo "==> more" | tee -a "$OUT/logs/steps.txt"
launch '{"EXPO_ROUTER_INITIAL_URL":"/(tabs)/more"}'
settle 5

echo "==> settings" | tee -a "$OUT/logs/steps.txt"
launch '{"EXPO_ROUTER_INITIAL_URL":"/more/settings"}'
settle 5

echo "==> accounts" | tee -a "$OUT/logs/steps.txt"
launch '{"EXPO_ROUTER_INITIAL_URL":"/more/accounts"}'
settle 5

echo "==> kdp-helper" | tee -a "$OUT/logs/steps.txt"
launch '{"EXPO_ROUTER_INITIAL_URL":"/more/kdp-helper"}'
settle 6

echo "==> sync" | tee -a "$OUT/logs/steps.txt"
launch '{"EXPO_ROUTER_INITIAL_URL":"/more/sync"}'
settle 5

echo "==> home settle" | tee -a "$OUT/logs/steps.txt"
launch '{"EXPO_ROUTER_INITIAL_URL":"/(tabs)"}'
settle 10

kill "$SP" 2>/dev/null || true
wait "$SP" 2>/dev/null || true

python3 - "$OUT" <<'PY'
import re, sys
from pathlib import Path
out = Path(sys.argv[1])
text = (out / "logs" / "signals.log").read_text(errors="replace")
# Ignore noisy system "Couldn't open" / SpringBoard scene failures
js_err = [
    ln for ln in text.splitlines()
    if re.search(r"ReactNativeJS.*(Error|TypeError|Unhandled|Invariant)", ln, re.I)
    or re.search(r"\[inteliads[^\]]*\][^\n]*(TypeError|Unhandled|Invariant Violation)", ln, re.I)
]
hard = [
    ln for ln in text.splitlines()
    if re.search(r"\[inteliads[^\]]*\][^\n]*(enrichment failed|Couldn't load period metrics|BooksReadError)", ln, re.I)
]
perf = [ln for ln in text.splitlines() if "[inteliads:perf]" in ln or "[inteliads:targeting]" in ln or "[inteliads:kdp-trace]" in ln]
(out / "logs" / "js_errors.txt").write_text("\n".join(js_err) + ("\n" if js_err else ""))
(out / "logs" / "hard_errors.txt").write_text("\n".join(hard) + ("\n" if hard else ""))
(out / "logs" / "summary.txt").write_text(
    f"js_errors={len(js_err)}\nhard_errors={len(hard)}\nperf_lines={len(perf)}\nsignal_lines={len(text.splitlines())}\n"
)
print(f"js_errors={len(js_err)} hard_errors={len(hard)} perf_lines={len(perf)}")
if js_err:
    print("FAIL js errors:")
    print("\n".join(js_err[:20]))
    sys.exit(1)
if hard:
    print("FAIL hard errors:")
    print("\n".join(hard[:20]))
    sys.exit(1)
print("DEVICE STRESS PASSED")
print(f"OUT={out}")
PY
