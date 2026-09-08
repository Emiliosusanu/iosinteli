#!/usr/bin/env bash
# Focused 14 Pro stress after installing a current build.
# Covers: periods, filters, widgets route hits, KDP helper tick, notification probe,
# bulk outbox drain wake. Uses QA AsyncStorage commands + syslog.
set -euo pipefail

UDID="${1:-00008120-001210563E6BC01E}"
BUNDLE="io.inteliads.app"
OUT="${STRESS_DEVICE_OUT:-/tmp/inteliads-14pro-stress-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT/logs" "$OUT/screens" "$OUT/as"
echo "$OUT" > /tmp/inteliads-14pro-stress-latest.path
echo "OUT=$OUT UDID=$UDID"

# Prefer local venv — Homebrew pymobiledevice3 is broken on Python 3.14 / pyexpat.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -x "$ROOT/.venv-device/bin/python" ]]; then
  PYMD=("$ROOT/.venv-device/bin/python" -m pymobiledevice3)
else
  PYMD=(pymobiledevice3)
fi

env_dev() { env -u PYMOBILEDEVICE3_UDID "$@"; }
# Pin every call to $UDID so multi-device USB (14 Pro + 17 Pro Max) cannot race.
# Hard-timeout each call — apps push/pull and DVT occasionally hang on iOS 26 tunnels.
pmd() {
  python3 - "$UDID" "${PYMD[@]}" "$@" <<'PY' || true
import subprocess, sys
udid = sys.argv[1]
cmd = sys.argv[2:] + ["--udid", udid]
import os
env = {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}
try:
    subprocess.run(cmd, env=env, timeout=45, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except subprocess.TimeoutExpired:
    print(f"[stress] TIMEOUT after 45s: {' '.join(cmd[:8])}", flush=True)
except Exception as e:
    print(f"[stress] ERR: {e}", flush=True)
PY
}
# Long-lived syslog must NOT use the timeout wrapper.
pmd_bg() { env_dev "${PYMD[@]}" "$@" --udid "$UDID"; }

kill_app() {
  pmd developer dvt pkill InteliAds
}

launch() {
  pmd developer dvt launch "$BUNDLE" --kill-existing
  # Targeting / multi-profile period lists often need >6s before first paint.
  sleep 10
}

shot() {
  local name="$1"
  pmd developer dvt screenshot "$OUT/screens/${name}.png"
}

pull_as() {
  rm -rf "$OUT/as/pull"
  mkdir -p "$OUT/as/pull"
  pmd apps pull "$BUNDLE" \
    "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1" \
    "$OUT/as/pull"
  if [[ -d "$OUT/as/pull/RCTAsyncLocalStorage_V1" ]]; then
    echo "$OUT/as/pull/RCTAsyncLocalStorage_V1"
  else
    echo "$OUT/as/pull"
  fi
}

push_qa() {
  local json="$1"
  kill_app
  sleep 0.6
  local local_as
  local_as="$(pull_as)"
  python3 - "$local_as" "$json" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]); cmd=json.loads(sys.argv[2])
man_path=root/"manifest.json"
man=json.loads(man_path.read_text()) if man_path.exists() else {}
# storage.setItem JSON-stringifies once
man["inteliads.qa.command"]=json.dumps(json.dumps(cmd))
man_path.write_text(json.dumps(man,separators=(",",":")))
print("wrote",cmd.get("id"))
PY
  for f in "$local_as"/manifest.json "$local_as"/*; do
    [[ -f "$f" ]] || continue
    # Prefer manifest first; skip duplicates from the glob
    [[ "$f" == */manifest.json && "$f" != "$local_as/manifest.json" ]] && continue
    pmd apps push "$BUNDLE" "$f" \
      "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1/$(basename "$f")"
    # Only need the manifest for QA command; other files are optional.
    [[ "$(basename "$f")" == "manifest.json" ]] && break
  done
}

# Syslog
pmd_bg syslog live -pn InteliAds --out "$OUT/logs/process.log" >/dev/null 2>"$OUT/logs/s1.err" &
SP1=$!
pmd_bg syslog live --insensitive-regex \
  'inteliads|ReactNativeJS|HOME_QUERY|BooksReadError|bulkOutbox|Kdp|BGTask|send-push|test-push|Couldn|TypeError|Unhandled|cooldown|Nest|Amazon|15 min sync|helper tick|extension_ios|supabase_session' \
  --out "$OUT/logs/signals.log" >/dev/null 2>"$OUT/logs/s2.err" &
SP2=$!
trap 'kill $SP1 $SP2 2>/dev/null || true' EXIT

run_case() {
  local id="$1"; shift
  echo "==> $id $*" | tee -a "$OUT/logs/steps.txt"
  push_qa "$*"
  launch
  shot "$id"
}

# Version check
python3 - <<PY | tee "$OUT/logs/version.txt"
import re,subprocess
r=subprocess.run(['$ROOT/.venv-device/bin/python','-m','pymobiledevice3','apps','list','--udid','$UDID'],capture_output=True,text=True)
m=re.search(r'"io\\.inteliads\\.app".*?"CFBundleShortVersionString"\\s*:\\s*"([^"]+)".*?"CFBundleVersion"\\s*:\\s*"([^"]+)"',r.stdout,re.S)
print('installed', m.groups() if m else 'unknown')
PY

# Period / tab matrix (focused, not full 90-day every tab)
run_case ov-month '{"id":"ov-month","route":"/(tabs)","periodMode":"month"}'
run_case ov-week '{"id":"ov-week","route":"/(tabs)","periodMode":"week"}'
run_case ov-prev1 '{"id":"ov-prev1","route":"/(tabs)","periodMode":"month","periodShift":-1}'
run_case camp-7d '{"id":"camp-7d","route":"/(tabs)/campaigns","dateLabel":"Last 7 days","campaignsSort":"acos","campaignsState":"enabled"}'
run_case camp-month '{"id":"camp-month","route":"/(tabs)/campaigns","dateLabel":"This month","campaignsSort":"spend"}'
run_case camp-orders '{"id":"camp-orders","route":"/(tabs)/campaigns","dateLabel":"Last 7 days","campaignsSort":"orders","campaignsState":"enabled"}'
run_case camp-top '{"id":"camp-top","route":"/(tabs)/campaigns","dateLabel":"This month","campaignsSort":"top","campaignsState":"all"}'
run_case camp-paused '{"id":"camp-paused","route":"/(tabs)/campaigns","dateLabel":"This month","campaignsSort":"acos","campaignsState":"paused"}'
run_case tgt-kw-waste '{"id":"tgt-kw-waste","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"wasting","targetsSort":"spend"}'
run_case tgt-kw-acos '{"id":"tgt-kw-acos","route":"/(tabs)/targeting","dateLabel":"Last 7 days","targetsSegment":"keywords","targetsPerf":"high_acos","targetsSort":"acos"}'
run_case tgt-kw-clicks '{"id":"tgt-kw-clicks","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"has_clicks","targetsSort":"clicks"}'
run_case tgt-kw-impr '{"id":"tgt-kw-impr","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"has_impressions","targetsSort":"impressions"}'
run_case tgt-kw-profit '{"id":"tgt-kw-profit","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"profitable","targetsSort":"acos"}'
run_case tgt-kw-nosales '{"id":"tgt-kw-nosales","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"no_sales","targetsSort":"spend"}'
run_case tgt-kw-bid '{"id":"tgt-kw-bid","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"all","targetsSort":"bid"}'
run_case tgt-asin-high '{"id":"tgt-asin-high","route":"/(tabs)/targeting","dateLabel":"Last 7 days","targetsSegment":"asins","targetsPerf":"high_acos","targetsSort":"acos"}'
run_case tgt-asin-orders '{"id":"tgt-asin-orders","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"asins","targetsPerf":"has_orders","targetsSort":"orders"}'
run_case tgt-asin-spend '{"id":"tgt-asin-spend","route":"/(tabs)/targeting","dateLabel":"Last 7 days","targetsSegment":"asins","targetsPerf":"wasting","targetsSort":"spend"}'
run_case tgt-auto '{"id":"tgt-auto","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"auto","targetsPerf":"all","targetsSort":"acos"}'
run_case tgt-auto-waste '{"id":"tgt-auto-waste","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"auto","targetsPerf":"wasting","targetsSort":"spend"}'
run_case tgt-auto-clicks '{"id":"tgt-auto-clicks","route":"/(tabs)/targeting","dateLabel":"Last 7 days","targetsSegment":"auto","targetsPerf":"has_clicks","targetsSort":"clicks"}'
run_case tgt-category '{"id":"tgt-category","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"category","targetsPerf":"all","targetsSort":"acos"}'
run_case tgt-category-high '{"id":"tgt-category-high","route":"/(tabs)/targeting","dateLabel":"Last 7 days","targetsSegment":"category","targetsPerf":"high_acos","targetsSort":"acos"}'
run_case tgt-category-impr '{"id":"tgt-category-impr","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"category","targetsPerf":"has_impressions","targetsSort":"impressions"}'
run_case tgt-place '{"id":"tgt-place","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"placement","targetsPerf":"all","targetsSort":"acos"}'
run_case tgt-place-spend '{"id":"tgt-place-spend","route":"/(tabs)/targeting","dateLabel":"Last 7 days","targetsSegment":"placement","targetsPerf":"has_impressions","targetsSort":"impressions"}'
run_case tgt-place-orders '{"id":"tgt-place-orders","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"placement","targetsPerf":"has_orders","targetsSort":"orders"}'
run_case tgt-low-acos '{"id":"tgt-low-acos","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"low_acos","targetsSort":"acos"}'
run_case tgt-adv-acos '{"id":"tgt-adv-acos","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"all","targetsSort":"acos","targetsAdvanced":{"acosMin":20,"acosMax":80}}'
run_case tgt-adv-bid '{"id":"tgt-adv-bid","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"all","targetsSort":"bid","targetsAdvanced":{"bidMin":0.2,"bidMax":2}}'
run_case tgt-adv-clicks '{"id":"tgt-adv-clicks","route":"/(tabs)/targeting","dateLabel":"Last 7 days","targetsSegment":"keywords","targetsPerf":"all","targetsSort":"clicks","targetsAdvanced":{"clicksMin":1}}'
run_case tgt-adv-impr '{"id":"tgt-adv-impr","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"asins","targetsPerf":"all","targetsSort":"impressions","targetsAdvanced":{"impressionsMin":100}}'
run_case books-net '{"id":"books-net","route":"/(tabs)/products","dateLabel":"This month","booksSort":"net"}'
run_case books-acos '{"id":"books-acos","route":"/(tabs)/products","dateLabel":"Last 30 days","booksSort":"acos"}'
run_case books-spend '{"id":"books-spend","route":"/(tabs)/products","dateLabel":"Last 7 days","booksSort":"spend"}'
run_case books-orders '{"id":"books-orders","route":"/(tabs)/products","dateLabel":"This month","booksSort":"orders"}'
run_case settings '{"id":"settings","route":"/(tabs)/more"}'
run_case settings-screen '{"id":"settings-screen","route":"/more/settings"}'
run_case accounts '{"id":"accounts","route":"/more/accounts"}'
run_case kdp-helper '{"id":"kdp-helper","route":"/more/kdp-helper"}'
run_case kdp-source '{"id":"kdp-source","route":"/more/kdp-source"}'
run_case sync '{"id":"sync","route":"/more/sync"}'
run_case ad-groups '{"id":"ad-groups","route":"/more/ad-groups"}'
run_case search-terms '{"id":"search-terms","route":"/more/search-terms"}'
# Background-ish: home return + settle for widgets
run_case ov-final '{"id":"ov-final","route":"/(tabs)","periodMode":"month"}'
sleep 12
shot ov-final-settle
# Extra settle shot on keywords with ACoS filter after longer wait
push_qa '{"id":"tgt-kw-settle","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"keywords","targetsPerf":"high_acos","targetsSort":"acos"}'
launch
sleep 8
shot tgt-kw-settle

# Pull storage for KDP / outbox / cache version
AS="$(pull_as)"
cp -R "$AS" "$OUT/as/final" 2>/dev/null || true
python3 - "$OUT" "$AS" <<'PY'
import json,re,sys
from pathlib import Path
out=Path(sys.argv[1]); root=Path(sys.argv[2])
man={}
mp=root/"manifest.json"
if mp.exists():
  man=json.loads(mp.read_text())
keys=sorted(man.keys())
interesting=[k for k in keys if any(x in k.lower() for x in ['kdp','bulk','querycache','selected','alert','qa','date'])]
lines=[f"manifest_keys={len(keys)}"]
for k in interesting:
  v=man.get(k)
  s=v if isinstance(v,str) else json.dumps(v)
  lines.append(f"\n=== {k} len={len(s)}\n{s[:1500]}")
# decode nested JSON strings
def peel(s):
  cur=s
  for _ in range(3):
    if isinstance(cur,str):
      try: cur=json.loads(cur)
      except Exception: break
    else: break
  return cur
sync=peel(man.get('inteliads.kdpHelper.syncState'))
bulk=peel(man.get('inteliads.bulkOutbox.v1'))
cache_v5='inteliads.queryCache.v6' in man
cache_v4='inteliads.queryCache.v4' in man
lines.append(f"\nCACHE v5={cache_v5} v4={cache_v4}")
lines.append(f"KDP syncState={json.dumps(sync)[:800] if sync else None}")
lines.append(f"BULK outbox={json.dumps(bulk)[:800] if bulk else None}")
(out/"logs"/"storage-summary.txt").write_text("\n".join(lines))
print("storage summary written")
PY

# Log analysis
python3 - "$OUT" <<'PY'
import re,sys
from pathlib import Path
out=Path(sys.argv[1])
text=""
for name in ("process.log","signals.log"):
  p=out/"logs"/name
  if p.exists(): text += p.read_text(errors="replace")+"\n"
qa=re.findall(r"\[inteliads:qa\][^\n]+", text)
perf=re.findall(r"\[inteliads:perf\][^\n]+", text)
data=re.findall(r"\[inteliads:(data|targeting|kdp)[^\]]*\][^\n]+", text)
errs=[ln for ln in text.splitlines() if re.search(r"HOME_QUERY_TIMEOUT|BooksReadError|TypeError|Unhandled JS|UnhandledPromise|INCOMPLETE_READ|AbortError|RCTRedBox|No script URL|Couldn't update|Couldn't save|ExceptionsManager|enrichment failed|Couldn't load period metrics|KDP helper|kdp.*skip|helper tick|WebView|KD12_.*FAIL|runKdpIosHelperTick", ln, re.I) and "locationd" not in ln and "UIAccessibility" not in ln and "duplicate item" not in ln]
cooldown=[ln for ln in text.splitlines() if re.search(r"cooldown|bulkOutbox|forceCooldown|Writing to Amazon|Queued for Amazon|Large bid change", ln, re.I)]
push=[ln for ln in text.splitlines() if re.search(r"send-push|test-push|requestServerTestPush|notification", ln, re.I)]
kdp=[ln for ln in text.splitlines() if re.search(r"\[inteliads:kdp|kdp-trace|BGTask|nightly|onboarding|15 min sync|helper tick|extension_ios", ln, re.I)]
fake=[ln for ln in text.splitlines() if re.search(r"fake zeros|lifetime totals|period metrics|Couldn't load period|noPeriodPlaceholder|fail.?closed", ln, re.I)]
summary=[
  f"OUT={out}",
  f"qa={len(qa)} perf={len(perf)} data={len(data)} errors={len(errs)} cooldown_hits={len(cooldown)} push_hits={len(push)} kdp_hits={len(kdp)} fake_data_hits={len(fake)}",
  "--- errors ---", *errs[-80:],
  "--- qa ---", *qa[-40:],
  "--- perf ---", *perf[-60:],
  "--- kdp ---", *kdp[-40:],
  "--- fake-data ---", *fake[-20:],
  "--- push ---", *push[-30:],
]
(out/"logs"/"summary.txt").write_text("\n".join(summary))
print("\n".join(summary[:14]))
print(f"SHOTS={(out/'screens').exists() and len(list((out/'screens').glob('*.png')))}")
# Fail the script if hard JS/data errors appeared
hard=[e for e in errs if re.search(r"TypeError|Unhandled|RCTRedBox|No script URL|ExceptionsManager|enrichment failed|Couldn't load period metrics", e, re.I)]
if hard:
  print(f"DEVICE_STRESS_HARD_ERRORS={len(hard)}")
  for e in hard[-20]: print(e)
  raise SystemExit(2)
print("DEVICE_STRESS_HARD_ERRORS=0")
PY

echo "DONE $OUT"
