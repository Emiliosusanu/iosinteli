#!/usr/bin/env bash
# Static + unit honesty gate for Targeting (filters, placement Nest-first, bulk, Impr/Clicks).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${INTELIADS_CERT_OUT:-/tmp/inteliads-targeting-honesty-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
fail=0

pass() { echo "PASS $1" | tee -a "$OUT/report.txt"; }
fail_() { echo "FAIL $1" | tee -a "$OUT/report.txt"; fail=1; }

{
  echo "OUT=$OUT"
  echo "=== targeting honesty cert ==="

  if rg -n 'label:\s*"Sales"|ADS_SALES' "$ROOT/app/(tabs)/targeting.tsx" >/dev/null; then
    fail_ "targeting list must not show Sales label"
  else
    pass "no Sales label on targeting rows"
  fi

  if rg -n 'segmentWrap|targeting-segments' "$ROOT/app/(tabs)/targeting.tsx" >/dev/null; then
    pass "segment chips always-visible wrap"
  else
    fail_ "missing segmentWrap / targeting-segments"
  fi

  if rg -n 'fetchAggregatedCampaigns' "$ROOT/src/lib/queries.ts" >/dev/null \
    && rg -n 'Nest campaign aggregation failed; falling back' "$ROOT/src/lib/queries.ts" >/dev/null; then
    pass "placement Nest-first with Supabase fallback"
  else
    fail_ "placement Nest-first path missing"
  fi

  if rg -n 'normalizePlacementCampaignMetrics' "$ROOT/app/(tabs)/targeting.tsx" >/dev/null; then
    pass "placement total_* metric normalize"
  else
    fail_ "placement metric normalize missing"
  fi

  if rg -n 'bottom:\s*t\.layout\.tabClearance' "$ROOT/app/(tabs)/targeting.tsx" >/dev/null \
    && rg -n 'targeting-bulk-bar|targeting-select-btn' "$ROOT/app/(tabs)/targeting.tsx" >/dev/null; then
    pass "bulk Select + bar above tab clearance"
  else
    fail_ "bulk Select/bar positioning missing"
  fi

  if rg -n 'resolveTargetingSortKey' "$ROOT/src/lib/targetingFilters.ts" >/dev/null \
    && rg -n 'BID_CHANGE_CONFIRM_PCT\s*=\s*30' "$ROOT/src/lib/targetingFilters.ts" >/dev/null; then
    pass "filter-driven sort + >30% bid guard"
  else
    fail_ "sort/guard helpers missing"
  fi

  if rg -n 'saveTargetingFilterMemory' "$ROOT/app/(tabs)/targeting.tsx" >/dev/null; then
    pass "filter persistence wired"
  else
    fail_ "filter persistence missing"
  fi

  echo "=== unit ==="
  cd "$ROOT"
  node --test --experimental-strip-types \
    tests/targeting-filters.test.js \
    tests/bulk-outbox.test.js \
    tests/filter-honesty.test.js | tee "$OUT/unit.txt"
} | tee "$OUT/report.txt"

echo "$OUT" > /tmp/inteliads-targeting-honesty-latest.path
if [[ "$fail" -ne 0 ]]; then
  echo "CERT_FAIL out=$OUT"
  exit 1
fi
echo "CERT_PASS out=$OUT"
exit 0
