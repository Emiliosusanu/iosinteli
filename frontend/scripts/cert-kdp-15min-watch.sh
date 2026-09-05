#!/usr/bin/env bash
# Watch KDP 15-min helper cadence on a physical device via AsyncStorage peels.
# PASS if lastSteadyAtMs advances at least once during the watch window, OR
# activityLog shows a "15 min sync" entry after watch start.
#
# Usage: bash scripts/cert-kdp-15min-watch.sh [UDID] [minutes]
# Note: iOS BGTaskScheduler does not guarantee delivery when locked/unplugged;
# the 15-min interval only runs reliably while the app process is alive.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UDID="${1:-00008150-00124D4C02EA401C}"
MINUTES="${2:-40}"
BUNDLE="io.inteliads.app"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${CERT_KDP_WATCH_OUT:-/tmp/inteliads-cert-kdp-watch-$TS}"
mkdir -p "$OUT/screens" "$OUT/logs" "$OUT/as" "$OUT/peels"

if [[ -x "$ROOT/.venv-device/bin/python" ]]; then
  PYMD=("$ROOT/.venv-device/bin/python" -m pymobiledevice3)
else
  PYMD=(pymobiledevice3)
fi

env_dev() { env -u PYMOBILEDEVICE3_UDID "$@"; }
# Pin every call to $UDID so multi-device USB cannot race.
pmd() { env_dev "${PYMD[@]}" "$@" --udid "$UDID"; }

echo "OUT=$OUT UDID=$UDID minutes=$MINUTES"
echo "NOTE: iOS BGTask is not guaranteed when locked/unplugged; interval only when process alive." | tee "$OUT/logs/note.txt"

kill_app() {
  pmd developer dvt pkill InteliAds >/dev/null 2>&1 || true
}

pull_as() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  pmd apps pull "$BUNDLE" \
    "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1" \
    "$dest" >/dev/null 2>&1 || true
  if [[ -d "$dest/RCTAsyncLocalStorage_V1" ]]; then
    echo "$dest/RCTAsyncLocalStorage_V1"
  else
    echo "$dest"
  fi
}

launch_sync() {
  local label="$1"
  kill_app
  sleep 0.5
  local local_as
  local_as="$(pull_as "$OUT/as/seed-$label")"
  python3 - "$local_as" <<'PY'
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
man_path = root / "manifest.json"
man = json.loads(man_path.read_text()) if man_path.exists() else {}
cmd = {"id": "cert-kdp-sync", "route": "/more/sync"}
man["inteliads.qa.command"] = json.dumps(json.dumps(cmd))
man_path.write_text(json.dumps(man, separators=(",", ":")))
print("wrote", cmd["id"])
PY
  for f in "$local_as"/*; do
    [[ -f "$f" ]] || continue
    pmd apps push "$BUNDLE" "$f" \
      "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1/$(basename "$f")" >/dev/null 2>&1 || true
  done
  pmd developer dvt launch "$BUNDLE" --kill-existing >/dev/null 2>&1 || true
  sleep 12
  pmd developer dvt screenshot "$OUT/screens/${label}.png" >/dev/null 2>&1 || true
}

peel_kdp() {
  local tag="$1"
  local peel_dir="$OUT/peels/$tag"
  local local_as
  local_as="$(pull_as "$peel_dir")"
  python3 - "$local_as" "$OUT/logs/peel-$tag.json" <<'PY'
import json, sys, time
from pathlib import Path

root = Path(sys.argv[1])
out_path = Path(sys.argv[2])
man = {}
mp = root / "manifest.json"
if mp.exists():
    man = json.loads(mp.read_text())

def peel(s):
    cur = s
    for _ in range(4):
        if isinstance(cur, str):
            try:
                cur = json.loads(cur)
            except Exception:
                break
        else:
            break
    return cur

sync = peel(man.get("inteliads.kdpHelper.syncState"))
activity = peel(man.get("inteliads.kdpHelper.activityLog"))
steady = 0
if isinstance(sync, dict):
    try:
        steady = int(sync.get("lastSteadyAtMs") or 0)
    except Exception:
        steady = 0
msgs = []
if isinstance(activity, list):
    for row in activity:
        if isinstance(row, dict) and isinstance(row.get("message"), str):
            msgs.append({"atMs": int(row.get("atMs") or 0), "message": row["message"]})

payload = {
    "ts": int(time.time() * 1000),
    "lastSteadyAtMs": steady,
    "activity": msgs[:24],
}
out_path.write_text(json.dumps(payload, indent=2))
age_s = (payload["ts"] - steady) / 1000 if steady else None
print(f"lastSteadyAtMs={steady} age_s={age_s if age_s is not None else 'n/a'} activity={len(msgs)}")
PY
}

# Start: open Sync once for screenshot + baseline peel
launch_sync "sync-start"
peel_kdp "t0"
START_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
BASELINE_STEADY="$(python3 - "$OUT/logs/peel-t0.json" <<'PY'
import json,sys
p=json.loads(open(sys.argv[1]).read())
print(int(p.get("lastSteadyAtMs") or 0))
PY
)"

INTERVAL_SEC=300
END_EPOCH=$(( $(date +%s) + MINUTES * 60 ))
n=1
while (( $(date +%s) < END_EPOCH )); do
  remaining=$(( END_EPOCH - $(date +%s) ))
  sleep_for=$INTERVAL_SEC
  if (( remaining < INTERVAL_SEC )); then
    sleep_for=$remaining
  fi
  if (( sleep_for <= 0 )); then
    break
  fi
  echo "==> watch sleep ${sleep_for}s (tick $n)" | tee -a "$OUT/logs/steps.txt"
  sleep "$sleep_for"
  peel_kdp "t$n" | tee -a "$OUT/logs/steps.txt"
  n=$((n + 1))
done

# End: Sync screenshot + final peel
launch_sync "sync-end"
peel_kdp "t-final" | tee -a "$OUT/logs/steps.txt"

python3 - "$OUT" "$START_MS" "$BASELINE_STEADY" <<'PY'
import json, sys
from pathlib import Path

out = Path(sys.argv[1])
start_ms = int(sys.argv[2])
baseline = int(sys.argv[3])
peels = sorted((out / "logs").glob("peel-*.json"))
steadies = []
saw_15 = False
for p in peels:
    data = json.loads(p.read_text())
    steady = int(data.get("lastSteadyAtMs") or 0)
    steadies.append(steady)
    for row in data.get("activity") or []:
        msg = str(row.get("message") or "")
        at = int(row.get("atMs") or 0)
        if "15 min sync" in msg and at >= start_ms:
            saw_15 = True

max_steady = max(steadies) if steadies else 0
advanced = max_steady > baseline
passed = advanced or saw_15
report = {
    "startMs": start_ms,
    "baselineLastSteadyAtMs": baseline,
    "maxLastSteadyAtMs": max_steady,
    "lastSteadyAdvanced": advanced,
    "activityHad15MinSyncAfterStart": saw_15,
    "pass": passed,
    "peels": [p.name for p in peels],
    "note": "iOS BGTask not guaranteed when locked/unplugged; interval only when process alive",
}
(out / "report.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if not passed:
    raise SystemExit(2)
print("CERT_KDP_WATCH_PASS=1")
PY

echo "DONE $OUT"
