#!/usr/bin/env bash
set -euo pipefail

BASELINE_COMMIT="e14241ad"
MINIMUM_BUILD=369
EXPECTED_BUNDLE_ID="io.inteliads.app"

ROOT="$(git rev-parse --show-toplevel)"
MARKER="$ROOT/.ios-canonical-worktree"

fail() {
  echo "iOS release guard: $*" >&2
  exit 1
}

[[ -f "$MARKER" ]] || fail "this checkout is not the blessed canonical worktree ($MARKER is missing)"
grep -qx "canonical-baseline=$BASELINE_COMMIT" "$MARKER" || fail "canonical marker does not match baseline $BASELINE_COMMIT"
grep -qx "canonical-path=$ROOT" "$MARKER" || fail "canonical marker belongs to another worktree"

git merge-base --is-ancestor "$BASELINE_COMMIT" HEAD || \
  fail "HEAD is not descended from external TestFlight build 369 ($BASELINE_COMMIT)"

cd "$ROOT/frontend"

app_build="$(node -p 'require("./app.json").expo.ios.buildNumber')"
info_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' ios/InteliAds/Info.plist)"
widget_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' ios/InteliAdsSyncWidget/Info.plist)"
project_builds="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([0-9][0-9]*\);.*/\1/p' ios/InteliAds.xcodeproj/project.pbxproj | sort -u)"
bundle_id="$(node -p 'require("./app.json").expo.ios.bundleIdentifier')"

[[ "$bundle_id" == "$EXPECTED_BUNDLE_ID" ]] || fail "bundle id is $bundle_id; expected $EXPECTED_BUNDLE_ID"
[[ "$app_build" =~ ^[0-9]+$ ]] || fail "app.json build number is invalid: $app_build"
(( app_build >= MINIMUM_BUILD )) || fail "build $app_build is older than certified baseline $MINIMUM_BUILD"
[[ "$info_build" == "$app_build" ]] || fail "Info.plist build $info_build differs from app.json $app_build"
[[ "$widget_build" == "$app_build" ]] || fail "widget build $widget_build differs from app.json $app_build"
[[ "$project_builds" == "$app_build" ]] || \
  fail "Xcode project build(s) [$project_builds] differ from app.json $app_build"

echo "iOS release guard: OK — build $app_build, bundle $bundle_id, baseline $BASELINE_COMMIT, worktree $ROOT"
