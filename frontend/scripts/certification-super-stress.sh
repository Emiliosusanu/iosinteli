#!/usr/bin/env bash
# Full certification super-stress: unit + static release gate + device stress +
# optional KDP 15-min watch. Writes /tmp/inteliads-cert-$ts/report.json.
#
# Usage: bash scripts/certification-super-stress.sh [UDID]
# Env:
#   CERT_KDP_WATCH_MINUTES  default 40; set 0 to skip KDP watch
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

UDID="${1:-00008150-00124D4C02EA401C}"
TS="$(date +%Y%m%d-%H%M%S)"
CERT_OUT="/tmp/inteliads-cert-$TS"
DEVICE_OUT="/tmp/inteliads-cert-device-$TS"
WATCH_MINUTES="${CERT_KDP_WATCH_MINUTES:-40}"
mkdir -p "$CERT_OUT"

echo "CERT_OUT=$CERT_OUT UDID=$UDID WATCH_MINUTES=$WATCH_MINUTES"

unit_pass=0
stress_pass=0
device_pass=0
kdp_pass=0
kdp_skipped=0
fail=0

run_step() {
  local name="$1"
  shift
  echo "==> $name" | tee -a "$CERT_OUT/steps.txt"
  set +e
  "$@" >"$CERT_OUT/${name}.log" 2>&1
  local rc=$?
  set -e
  tail -40 "$CERT_OUT/${name}.log" | tee -a "$CERT_OUT/steps.txt" >/dev/null || true
  if [[ $rc -eq 0 ]]; then
    echo "PASS $name" | tee -a "$CERT_OUT/steps.txt"
    return 0
  fi
  echo "FAIL $name (exit $rc)" | tee -a "$CERT_OUT/steps.txt"
  return 1
}

if run_step unit npm run test:unit; then
  unit_pass=1
else
  fail=1
fi

if run_step stress bash scripts/stress-test-release.sh; then
  stress_pass=1
else
  fail=1
fi

if run_step device env STRESS_DEVICE_OUT="$DEVICE_OUT" bash scripts/device-stress-14pro.sh "$UDID"; then
  device_pass=1
else
  fail=1
fi

if [[ "$WATCH_MINUTES" =~ ^[0-9]+$ ]] && (( WATCH_MINUTES > 0 )); then
  if run_step kdp-watch bash scripts/cert-kdp-15min-watch.sh "$UDID" "$WATCH_MINUTES"; then
    kdp_pass=1
  else
    fail=1
  fi
else
  kdp_skipped=1
  echo "SKIP kdp-watch (CERT_KDP_WATCH_MINUTES=$WATCH_MINUTES)" | tee -a "$CERT_OUT/steps.txt"
fi

python3 - "$CERT_OUT" "$DEVICE_OUT" "$UDID" "$TS" "$unit_pass" "$stress_pass" "$device_pass" "$kdp_pass" "$kdp_skipped" "$fail" "$WATCH_MINUTES" <<'PY'
import json, sys
from pathlib import Path

(
    cert_out,
    device_out,
    udid,
    ts,
    unit_pass,
    stress_pass,
    device_pass,
    kdp_pass,
    kdp_skipped,
    fail,
    watch_minutes,
) = sys.argv[1:]

report = {
    "ts": ts,
    "udid": udid,
    "certOut": cert_out,
    "deviceOut": device_out,
    "watchMinutes": int(watch_minutes),
    "unit": {"pass": unit_pass == "1"},
    "stress": {"pass": stress_pass == "1"},
    "device": {"pass": device_pass == "1", "out": device_out},
    "kdpWatch": {
        "pass": kdp_pass == "1",
        "skipped": kdp_skipped == "1",
    },
    "pass": fail == "0",
}
Path(cert_out, "report.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if fail != "0":
    raise SystemExit(1)
PY

echo "CERTIFICATION_PASS=1 OUT=$CERT_OUT"
