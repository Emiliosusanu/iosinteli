#!/usr/bin/env bash
# Pre-TestFlight stress gate: unit tests + static audits for stale cache and fake data.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${STRESS_OUT:-/tmp/inteliads-stress-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"

echo "==> Unit tests" | tee "$OUT/summary.txt"
npm run test:unit 2>&1 | tee "$OUT/unit.log"
tail -8 "$OUT/unit.log" | tee -a "$OUT/summary.txt"

echo "==> Static release audits" | tee -a "$OUT/summary.txt"
FAIL=0

audit() {
  local name="$1"
  local pattern="$2"
  local file="$3"
  local mode="${4:-must}"
  if [[ "$mode" == "must" ]]; then
    if rg -q "$pattern" "$file"; then
      echo "PASS $name" | tee -a "$OUT/summary.txt"
    else
      echo "FAIL $name (missing: $pattern in $file)" | tee -a "$OUT/summary.txt"
      FAIL=1
    fi
  elif [[ "$mode" == "forbid" ]]; then
    if rg -q "$pattern" "$file"; then
      echo "FAIL $name (forbidden: $pattern in $file)" | tee -a "$OUT/summary.txt"
      FAIL=1
    else
      echo "PASS $name" | tee -a "$OUT/summary.txt"
    fi
  fi
}

audit "usableCachedHomeSnapshot guard" "usableCachedHomeSnapshot" "app/(tabs)/index.tsx"
audit "snapshot max age" "SNAPSHOT_MAX_AGE_MS" "src/lib/mobileHomeSnapshot.ts"
audit "background sync wake" "installBackgroundSyncWakeHandlers" "src/lib/notifications.ts"
audit "server test push" "requestServerTestPush" "src/lib/notifications.ts"
audit "no fake zero on missing KDP" "publisherNetForPeriod" "app/(tabs)/index.tsx"
audit "no hardcoded demo totals" "1234\\.56|9999\\.99" "app/(tabs)/index.tsx" "forbid"
audit "displayMetric null on missing" "displayMetric" "src/lib/mobileHomeSnapshot.ts"
audit "verified_zero not treated as missing" "verified_zero" "src/lib/mobileHomeSnapshot.ts"

echo "==> Tab / targeting audits" | tee -a "$OUT/summary.txt"
audit "targets prefetch all segments" "enabled: selectedProfileIds.length > 0" "app/(tabs)/targeting.tsx"
audit "targets period isolation" "noPeriodPlaceholder" "app/(tabs)/targeting.tsx"
audit "targets perf logs" "\\[inteliads:targeting\\]" "app/(tabs)/targeting.tsx"
audit "targets timeout 60s" "TARGETING_QUERY_TIMEOUT_MS = 60_000" "src/lib/queryTimeout.ts"
audit "metric totals fast path" "chunkArray\\(ids, 80\\)" "src/lib/queries.ts"
audit "metric totals no sort" "fetchMetricTotalsByEntity" "src/lib/queries.ts"
audit "alert check cooldown" "ALERT_CHECK_COOLDOWN_MS" "src/lib/notifications.ts"
audit "keyword metrics non-fatal" "keyword metrics enrichment failed" "src/lib/queries.ts"
audit "overview swipe widgets" "OverviewSwipeWidget" "app/(tabs)/index.tsx"
audit "dual-source background refresh" "runDualSourceBackgroundRefresh" "src/lib/backgroundFinancialSync.ts"
audit "books top royalties page" "Top royalties" "app/(tabs)/index.tsx"
audit "overview books period scope" "activityDays: 0" "app/(tabs)/index.tsx"
audit "books tab period scope" "activityDays: 0" "app/(tabs)/products.tsx"
audit "overview widget fill cascade" "fillOverviewWidgetRows" "src/lib/overviewWidgets.ts"
audit "overview swipe height measure" "overview-swipe-page" "src/components/OverviewSwipeWidget.tsx"
audit "kdp keychain session" "AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY" "src/lib/kdp/session.ts"
audit "kdp push wake tick" "runKdpIosHelperTick\\(\"push\"\\)" "src/lib/notifications.ts"
audit "settings kdp accounts row" "settings-kdp-accounts" "app/more/settings.tsx"
audit "settings subscription row" "settings-subscription-status" "app/more/settings.tsx"

echo "==> Result: OUT=$OUT" | tee -a "$OUT/summary.txt"
if [[ "$FAIL" -ne 0 ]]; then
  echo "STRESS GATE FAILED" | tee -a "$OUT/summary.txt"
  exit 1
fi
echo "STRESS GATE PASSED" | tee -a "$OUT/summary.txt"
