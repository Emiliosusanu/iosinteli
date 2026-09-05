#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UDID="${1:-00008120-001210563E6BC01E}"
BUNDLE=io.inteliads.app
OUT="/tmp/inteliads-14pro-focus-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT/screens" "$OUT/logs" "$OUT/as"
PYMD=("$ROOT/.venv-device/bin/python" -m pymobiledevice3)
# Always pin --udid so a second phone (e.g. 17 Pro Max) cannot steal the session.
env_dev(){ env -u PYMOBILEDEVICE3_UDID "$@"; }
pmd(){ env_dev "${PYMD[@]}" "$@" --udid "$UDID"; }
echo "OUT=$OUT UDID=$UDID"
kill_app(){ pmd developer dvt pkill InteliAds >/dev/null 2>&1 || true; }
pull_as(){
  rm -rf "$OUT/as/pull"; mkdir -p "$OUT/as/pull"
  pmd apps pull "$BUNDLE" "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1" "$OUT/as/pull" >/dev/null 2>&1 || true
  if [[ -d "$OUT/as/pull/RCTAsyncLocalStorage_V1" ]]; then echo "$OUT/as/pull/RCTAsyncLocalStorage_V1"; else echo "$OUT/as/pull"; fi
}
push_qa(){
  kill_app; sleep 0.5
  local local_as; local_as="$(pull_as)"
  python3 - "$local_as" "$1" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]); cmd=json.loads(sys.argv[2]); man_path=root/"manifest.json"
man=json.loads(man_path.read_text()) if man_path.exists() else {}
man["inteliads.qa.command"]=json.dumps(json.dumps(cmd))
man_path.write_text(json.dumps(man,separators=(",",":")))
print("wrote", cmd.get("id"))
PY
  for f in "$local_as"/*; do
    [[ -f "$f" ]] || continue
    pmd apps push "$BUNDLE" "$f" "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1/$(basename "$f")" >/dev/null 2>&1 || true
  done
}
run(){
  echo "==> $1"
  push_qa "$2"
  pmd developer dvt launch "$BUNDLE" --kill-existing >/dev/null 2>&1 || true
  sleep "$3"
  pmd developer dvt screenshot "$OUT/screens/$1.png" >/dev/null 2>&1 || true
}
pmd syslog live --insensitive-regex 'inteliads|TypeError|Unhandled|enrichment failed|Couldn|kdp|15 min sync|helper tick|extension_ios' --out "$OUT/logs/sig.log" >/dev/null 2>&1 &
SP=$!
run place-settle '{"id":"place-settle","route":"/(tabs)/targeting","dateLabel":"This month","targetsSegment":"placement","targetsPerf":"all","targetsSort":"acos"}' 18
run camp-settle '{"id":"camp-settle","route":"/(tabs)/campaigns","dateLabel":"Last 7 days","campaignsSort":"acos","campaignsState":"enabled"}' 16
run kdp-helper '{"id":"kdp-helper","route":"/more/kdp-helper"}' 12
run kdp-source '{"id":"kdp-source","route":"/more/kdp-source"}' 10
run ad-groups '{"id":"ad-groups","route":"/more/ad-groups"}' 14
run sync '{"id":"sync","route":"/more/sync"}' 12
kill "$SP" 2>/dev/null || true
python3 - "$OUT" <<'PY'
import re,sys
from pathlib import Path
out=Path(sys.argv[1])
text=(out/"logs"/"sig.log").read_text(errors="replace") if (out/"logs"/"sig.log").exists() else ""
errs=[ln for ln in text.splitlines() if re.search(r"TypeError|Unhandled|enrichment failed|Couldn.t load period|RCTRedBox", ln, re.I)]
print("OUT", out)
print("errors", len(errs))
for e in errs[-10:]:
  print(e)
for p in sorted((out/"screens").glob("*.png")):
  print(p.name, p.stat().st_size)
PY
echo "DONE $OUT"
