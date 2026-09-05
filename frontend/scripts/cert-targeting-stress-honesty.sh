#!/usr/bin/env bash
# Stress honesty cert: bulk edit + every Targeting filter surface across
# Keywords / ASINs / Auto / Category / Placement.
#
# Covers: profile scope, book filter, date/period isolation, ACoS/bid/clicks/impr
# ranges, perf chips, bulk Bid ± + cooldown + outbox honesty, no fake/misleading data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${INTELIADS_CERT_OUT:-/tmp/inteliads-targeting-stress-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
: >"$OUT/report.txt"
fail=0

pass() { echo "PASS $1" | tee -a "$OUT/report.txt"; }
fail_() { echo "FAIL $1" | tee -a "$OUT/report.txt"; fail=1; }

must() {
  local name="$1" pattern="$2" file="$3"
  if rg -q -- "$pattern" "$file"; then pass "$name"
  else fail_ "$name (missing /$pattern/ in $file)"
  fi
}

must_f() {
  local name="$1" needle="$2" file="$3"
  if rg -F -- "$needle" "$file" >/dev/null; then pass "$name"
  else fail_ "$name (missing '$needle' in $file)"
  fi
}

forbid() {
  local name="$1" pattern="$2" file="$3"
  if rg -q -- "$pattern" "$file"; then fail_ "$name (forbidden /$pattern/ in $file)"
  else pass "$name"
  fi
}

echo "OUT=$OUT" | tee -a "$OUT/report.txt"
echo "=== targeting stress honesty cert ===" | tee -a "$OUT/report.txt"

must "five segments" 'key: "placement"' "$ROOT/app/(tabs)/targeting.tsx"
must "keywords segment" 'key: "keywords"' "$ROOT/app/(tabs)/targeting.tsx"
must "asins segment" 'key: "asins"' "$ROOT/app/(tabs)/targeting.tsx"
must "auto segment" 'key: "auto"' "$ROOT/app/(tabs)/targeting.tsx"
must "category segment" 'key: "category"' "$ROOT/app/(tabs)/targeting.tsx"
must "segment wrap always visible" 'targeting-segments' "$ROOT/app/(tabs)/targeting.tsx"

must "profile sorted ids" 'sortedProfileIds' "$ROOT/app/(tabs)/targeting.tsx"
must "period query key" 'financialPeriodQueryKey' "$ROOT/app/(tabs)/targeting.tsx"
must "no period placeholder bleed" 'noPeriodPlaceholder' "$ROOT/app/(tabs)/targeting.tsx"

must_f "book filter campaign or KDP" 'campaign or KDP books' "$ROOT/app/(tabs)/targeting.tsx"
must "book cover list rows" 'bookList' "$ROOT/app/(tabs)/targeting.tsx"
must "book filter search" 'targeting-book-search' "$ROOT/app/(tabs)/targeting.tsx"
must "book filter dedupe" 'dedupeTargetingBookOptions' "$ROOT/src/lib/queries.ts"
must 'enabled product ads only' 'eq\("status", "enabled"\)' "$ROOT/src/lib/queries.ts"
must 'enabled campaigns only' 'campaigns\.state", "enabled"' "$ROOT/src/lib/queries.ts"

must "adv bid max" 'targeting-adv-bid-max' "$ROOT/app/(tabs)/targeting.tsx"
must "adv acos max" 'targeting-adv-acos-max' "$ROOT/app/(tabs)/targeting.tsx"
must "adv clicks max" 'targeting-adv-clicks-max' "$ROOT/app/(tabs)/targeting.tsx"
must "adv impr max" 'targeting-adv-impr-max' "$ROOT/app/(tabs)/targeting.tsx"
must "decimal draft parser" 'parseFilterRangeInput' "$ROOT/app/(tabs)/targeting.tsx"
must "placement ignores bid ranges" 'advancedFiltersForSegment' "$ROOT/app/(tabs)/targeting.tsx"
must_f "bid ranges ignored copy" "Bid ranges don't apply on Placement" "$ROOT/app/(tabs)/targeting.tsx"
must_f "ranges section title" 'Ranges' "$ROOT/app/(tabs)/targeting.tsx"
must_f "no sales perf chip" 'label: "No sales"' "$ROOT/app/(tabs)/targeting.tsx"

must_f "bulk Bid +$ label" 'Bid +$' "$ROOT/app/(tabs)/targeting.tsx"
must_f "bulk Bid −$ label" 'Bid −$' "$ROOT/app/(tabs)/targeting.tsx"
must "bulk cooldown chip" 'targeting-cooldown-selected' "$ROOT/app/(tabs)/targeting.tsx"
must_f "bulk cooldown alert" 'on cooldown' "$ROOT/app/(tabs)/targeting.tsx"
must_f "bulk outbox key" 'inteliads.bulkOutbox.v1' "$ROOT/src/lib/bulkOutbox.ts"
must_f "not Amazon-confirmed copy" 'Not confirmed on Amazon yet' "$ROOT/app/(tabs)/targeting.tsx"
must_f "placement gates bulk bid" 'Increase / decrease bid applies to keywords and targets' "$ROOT/app/(tabs)/targeting.tsx"

must_f "fail-closed keyword metrics" 'Never paint lifetime totals or fake zeros' "$ROOT/src/lib/queries.ts"
must_f "filter miss vs missing data" 'No matches' "$ROOT/app/(tabs)/targeting.tsx"
must_f "list cap not write limit" 'Not an Amazon write limit' "$ROOT/src/lib/queries.ts"
must_f "list cap UI honesty" 'Showing {TARGETING_LIST_LIMIT} (app limit)' "$ROOT/app/(tabs)/targeting.tsx"
must_f "fair per-profile honesty" 'fair per-profile' "$ROOT/src/lib/queries.ts"
must_f "bulk selected visible only" 'selected visible / filtered rows' "$ROOT/app/(tabs)/targeting.tsx"
must_f "Nest placement first" 'Nest campaign aggregation failed; falling back' "$ROOT/src/lib/queries.ts"
must_f "Nest null placement shares" 'placement_top_share: null' "$ROOT/src/lib/dashboardApi.ts"

forbid "no Sales on targeting" 'label: "Sales"' "$ROOT/app/(tabs)/targeting.tsx"
forbid "no demo totals" '1234\.56|9999\.99' "$ROOT/app/(tabs)/targeting.tsx"
forbid "no invent placement zeros prefetch" 'top_of_search: 0,\s*product_pages: 0,\s*rest_of_search: 0' "$ROOT/src/lib/mutations.ts"

echo "=== unit stress suite ===" | tee -a "$OUT/report.txt"
cd "$ROOT"
HELPER="${HELPER:-/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node}"
if [[ ! -x "$HELPER" ]]; then
  HELPER="$(command -v node || true)"
fi
set +e
"$HELPER" --experimental-strip-types --test --test-force-exit \
  tests/targeting-stress-honesty.test.js \
  tests/targeting-filters.test.js \
  tests/filter-honesty.test.js \
  tests/bulk-outbox.test.js \
  tests/bid-cooldown-funnel.test.js \
  tests/period-query.test.js \
  tests/qa-command.test.js | tee "$OUT/unit.txt"
unit_rc=${PIPESTATUS[0]}
set -e

echo "$OUT" > /tmp/inteliads-targeting-stress-latest.path

if [[ "$fail" -ne 0 ]] || [[ "$unit_rc" -ne 0 ]] || rg -q '^not ok ' "$OUT/unit.txt"; then
  echo "CERT_FAIL out=$OUT fail=$fail unit_rc=$unit_rc"
  exit 1
fi

echo "CERT_PASS out=$OUT"
exit 0
