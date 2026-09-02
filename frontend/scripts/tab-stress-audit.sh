#!/usr/bin/env bash
# Static tab-by-tab certification: every main screen must handle timeout/offline and log inteliads tags.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${TAB_STRESS_OUT:-/tmp/inteliads-tab-stress-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
FAIL=0

check() {
  local name="$1"
  local pattern="$2"
  local file="$3"
  if rg -q "$pattern" "$file"; then
    echo "PASS $name" | tee -a "$OUT/summary.txt"
  else
    echo "FAIL $name (need $pattern in $file)" | tee -a "$OUT/summary.txt"
    FAIL=1
  fi
}

forbid() {
  local name="$1"
  local pattern="$2"
  local file="$3"
  if rg -q "$pattern" "$file"; then
    echo "FAIL $name (forbidden $pattern in $file)" | tee -a "$OUT/summary.txt"
    FAIL=1
  else
    echo "PASS $name" | tee -a "$OUT/summary.txt"
  fi
}

echo "==> Tab stress static audit OUT=$OUT" | tee "$OUT/summary.txt"

check "overview timeout handling" "isHomeQueryTimeout|homeWidgetStatus" "app/(tabs)/index.tsx"
check "overview inteliads logs" "\\[inteliads:perf\\]|markPerf" "app/(tabs)/index.tsx"
check "campaigns retry" "RetryState|Couldn't load" "app/(tabs)/campaigns.tsx"
check "targets retry + timeout copy" "RetryState|isHomeQueryTimeout|This range took too long" "app/(tabs)/targeting.tsx"
check "targets segment prefetch" "enabled: selectedProfileIds.length > 0" "app/(tabs)/targeting.tsx"
forbid "targets segment-gated fetch" "enabled:[^\n]*segment" "app/(tabs)/targeting.tsx"
check "targets debug channel" "\\[inteliads:targeting\\]" "app/(tabs)/targeting.tsx"
check "books retry path" "RetryState|Couldn't load|ScreenSpinner" "app/(tabs)/products.tsx"
check "notification dedup ids" "notificationIdentifier" "src/lib/notificationContract.ts"
check "notification digest hour gate" "shouldSendDigestHour" "src/lib/notificationDigest.ts"
check "alert cooldown" "ALERT_CHECK_COOLDOWN_MS" "src/lib/notifications.ts"
check "fast metric enrichment" "chunkArray\\(ids, 80\\)" "src/lib/queries.ts"
check "overview swipe widgets" "OverviewSwipeWidget" "app/(tabs)/index.tsx"
check "overview widget sorts" "keywordsSpendingNoOrders" "src/lib/overviewWidgets.ts"
check "overview swipe rows" "KeywordWidgetRow" "src/components/OverviewWidgetRows.tsx"
forbid "ads funnel removed" "Ads funnel" "app/(tabs)/index.tsx"

echo "==> Unit tests (tab-related)" | tee -a "$OUT/summary.txt"
npm run test:unit -- tests/data-mapping.test.js tests/postgrest-read-completeness.test.js tests/notification-infra.test.js 2>&1 | tee "$OUT/unit.log"
tail -6 "$OUT/unit.log" | tee -a "$OUT/summary.txt"

if [[ "$FAIL" -ne 0 ]]; then
  echo "TAB STRESS AUDIT FAILED" | tee -a "$OUT/summary.txt"
  exit 1
fi
echo "TAB STRESS AUDIT PASSED" | tee -a "$OUT/summary.txt"
