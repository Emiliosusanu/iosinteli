#!/usr/bin/env bash
# TestFlight pipeline: stress gate → EAS production iOS build → submit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Stress gate"
bash "$ROOT/scripts/stress-test-release.sh"

if ! command -v eas >/dev/null 2>&1; then
  echo "EAS CLI not installed. Run: npm install -g eas-cli && eas login"
  exit 1
fi

echo "==> EAS build (production / TestFlight)"
eas build --platform ios --profile production --non-interactive

echo "==> EAS submit to TestFlight"
eas submit --platform ios --profile production --latest --non-interactive

echo "DONE — check App Store Connect → TestFlight for processing status."
