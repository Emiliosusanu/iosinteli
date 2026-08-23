import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ADS_NEEDS_REVIEW_LABEL,
  ADS_UP_TO_DATE_LABEL,
  AMS_SECTION_SUBTITLE,
  AMS_SECTION_TITLE,
  CANCEL_CONFIRM_MESSAGE,
  CANCEL_CONFIRM_TITLE,
  CHECKING_STATUS_LABEL,
  STATUS_UNAVAILABLE_LABEL,
  LOADING_LOGS_LABEL,
  NO_SELECTED_SUBTITLE,
  NO_SELECTED_TITLE,
  RECORDS_FOOTNOTE,
  REFRESH_A11Y_HINT,
  SCOPE_HELPER,
  SELECT_PROFILE_FOR_FRESHNESS_LABEL,
  VIEWING_CUSTOMER_BANNER,
  amsEventLabel,
  deriveSyncHero,
  formatSyncWhen,
  latestLogPerProfile,
  looksLikeExpiredAmazonToken,
  needsReviewNote,
  profileRunDisplayName,
  profileRunWhenLabel,
  reconnectRequiredFromLatest,
  resolvePresentedHero,
  sessionRowAccessibilityLabel,
  syncHeroAccessibilityLabel,
  syncHeroDetail,
} from "../src/lib/syncContract.ts";

const screen = readFileSync(new URL("../app/more/sync.tsx", import.meta.url), "utf8");

test("empty selected profiles is not Amazon disconnect", () => {
  assert.equal(NO_SELECTED_TITLE, "No profiles in the current view");
  assert.match(NO_SELECTED_SUBTITLE, /enabled profiles/);
  assert.match(screen, /NO_SELECTED_TITLE/);
  assert.doesNotMatch(screen, /No account connected/);
});

test("selected view is not Sync Now scope", () => {
  assert.equal(SCOPE_HELPER, "Showing selected profiles. Sync runs for all enabled profiles.");
  assert.match(screen, /SCOPE_HELPER/);
  assert.match(screen, /Selected profiles/);
});

test("loading is not presented as Amazon Ads syncing", () => {
  const checking = resolvePresentedHero({
    inProgress: false,
    statusKnown: false,
    logsKnown: false,
    hasSelectedProfiles: true,
    profiles: [],
  });
  assert.equal(checking.label, CHECKING_STATUS_LABEL);
  assert.equal(checking.provisional, true);
  assert.notEqual(checking.label, ADS_UP_TO_DATE_LABEL);

  const logs = resolvePresentedHero({
    inProgress: false,
    statusKnown: true,
    logsKnown: false,
    hasSelectedProfiles: true,
    profiles: [],
  });
  assert.equal(logs.label, LOADING_LOGS_LABEL);
  assert.notEqual(logs.label, "Amazon Ads not synced yet");

  const failedStatus = resolvePresentedHero({
    inProgress: false,
    statusKnown: false,
    statusFailed: true,
    logsKnown: false,
    hasSelectedProfiles: false,
    profiles: [],
  });
  assert.equal(failedStatus.label, STATUS_UNAVAILABLE_LABEL);
  assert.notEqual(failedStatus.label, CHECKING_STATUS_LABEL);

  const pending = resolvePresentedHero({
    inProgress: true,
    statusKnown: true,
    logsKnown: false,
    hasSelectedProfiles: true,
    profiles: [],
  });
  assert.match(pending.label, /Syncing Amazon Ads/);
  assert.equal(pending.provisional, false);
});

test("does not claim up to date without selected profile logs", () => {
  const noSelection = resolvePresentedHero({
    inProgress: false,
    statusKnown: true,
    logsKnown: false,
    hasSelectedProfiles: false,
    profiles: [],
  });
  assert.equal(noSelection.label, SELECT_PROFILE_FOR_FRESHNESS_LABEL);
  assert.notEqual(noSelection.label, ADS_UP_TO_DATE_LABEL);
});

test("presented hero still uses the verified contract when logs are known", () => {
  const profiles = [
    { status: "completed", completed_at: "2026-08-22T12:00:00Z", started_at: "2026-08-22T11:00:00Z" },
  ];
  const presented = resolvePresentedHero({
    inProgress: false,
    statusKnown: true,
    logsKnown: true,
    hasSelectedProfiles: true,
    profiles,
  });
  assert.deepEqual(presented, { ...deriveSyncHero({ inProgress: false, profiles }), provisional: false });
});

test("profile row time does not call a failed run Updated", () => {
  const now = Date.parse("2026-08-22T12:12:00Z");
  assert.equal(
    profileRunWhenLabel(
      { status: "completed", completed_at: "2026-08-22T12:00:00Z", started_at: "2026-08-22T11:00:00Z" },
      now,
    ),
    "Updated 12 min ago",
  );
  assert.equal(
    profileRunWhenLabel(
      { status: "failed", completed_at: "2026-08-22T12:00:00Z", started_at: "2026-08-22T11:00:00Z" },
      now,
    ),
    "12 min ago",
  );
  assert.equal(
    profileRunWhenLabel({ status: "pending", completed_at: null, started_at: "2026-08-22T12:10:00Z" }, now),
    "Started 2 min ago",
  );
});

test("last success uses completed_at, pending uses Started", () => {
  const now = Date.parse("2026-08-22T12:12:00Z");
  const updated = syncHeroDetail({
    inProgress: false,
    freshness: "completed",
    profiles: [{ status: "completed", completed_at: "2026-08-22T12:00:00Z", started_at: "2026-08-22T11:00:00Z" }],
    now,
  });
  assert.equal(updated, "Updated 12 min ago");
  assert.doesNotMatch(updated, /Started/);

  const started = syncHeroDetail({
    inProgress: true,
    freshness: "started",
    profiles: [{ status: "pending", completed_at: null, started_at: "2026-08-22T12:10:00Z" }],
    now,
  });
  assert.equal(started, "Started 2 min ago");
});

test("latest per profile and needs-review distinguish current vs older window fails", () => {
  const logs = [
    { amazon_profile_id: "a", profile_name: "US Ads", status: "completed", completed_at: "2026-08-22T12:00:00Z" },
    { amazon_profile_id: "b", profile_name: "UK Ads", status: "failed", completed_at: "2026-08-22T11:00:00Z" },
    { amazon_profile_id: "a", profile_name: "US Ads", status: "failed", completed_at: "2026-08-21T12:00:00Z" },
  ];
  const latest = latestLogPerProfile(logs);
  assert.equal(latest.length, 2);
  assert.equal(latest[0].status, "completed");
  assert.equal(latest[1].status, "failed");
  assert.equal(profileRunDisplayName({ profile_name: null }), "Amazon profile");
  assert.equal(
    needsReviewNote({ heroLabel: ADS_NEEDS_REVIEW_LABEL, latest, logs }),
    "UK Ads needs review.",
  );

  const recovered = [
    { amazon_profile_id: "a", profile_name: "US Ads", status: "completed" },
  ];
  const recoveredLogs = [
    ...recovered,
    { amazon_profile_id: "a", profile_name: "US Ads", status: "failed" },
  ];
  assert.equal(
    needsReviewNote({ heroLabel: ADS_NEEDS_REVIEW_LABEL, latest: recovered, logs: recoveredLogs }),
    "An earlier run in this log window failed or partially failed.",
  );
});

test("expired-token CTA only matches strong LWA evidence", () => {
  assert.equal(looksLikeExpiredAmazonToken("invalid_grant"), true);
  assert.equal(looksLikeExpiredAmazonToken("refresh token expired"), true);
  assert.equal(looksLikeExpiredAmazonToken("Unauthorized"), false);
  assert.equal(looksLikeExpiredAmazonToken("report failed"), false);
  assert.equal(reconnectRequiredFromLatest([{ error_message: "invalid_grant" }]), true);
  assert.equal(reconnectRequiredFromLatest([{ error_message: "timeout" }]), false);
});

test("cancel confirm is stop-not-delete, records are demoted, AMS stays separate", () => {
  assert.equal(CANCEL_CONFIRM_TITLE, "Cancel current Amazon Ads sync?");
  assert.match(CANCEL_CONFIRM_MESSAGE, /already imported stays/);
  assert.doesNotMatch(CANCEL_CONFIRM_TITLE + CANCEL_CONFIRM_MESSAGE, /Delete sync|rolled back/i);
  assert.match(screen, /CANCEL_CONFIRM_TITLE/);
  assert.match(RECORDS_FOOTNOTE, /Not catalog size/);
  assert.match(screen, /logWindowCaption/);
  assert.doesNotMatch(screen, /label="Records"/);
  assert.equal(AMS_SECTION_TITLE, "Marketing Stream");
  assert.match(AMS_SECTION_SUBTITLE, /does not refresh/);
  assert.equal(amsEventLabel("CAMPAIGN_CLICK"), "CAMPAIGN CLICK");
});

test("VoiceOver copy uses Amazon Ads state, not color-only status", () => {
  assert.equal(
    syncHeroAccessibilityLabel({
      label: "Amazon Ads up to date",
      detail: "Updated 12 minutes ago",
    }),
    "Amazon Ads up to date. Updated 12 minutes ago",
  );
  assert.match(
    sessionRowAccessibilityLabel({ type: "hourly", status: "completed", when: "Updated 1 hour ago" }),
    /Scheduled/,
  );
  assert.match(REFRESH_A11Y_HINT, /Does not start a new sync/);
  assert.match(screen, /REFRESH_A11Y_HINT/);
  assert.match(screen, /accessibilityLabel=\{statusSpeech\}/);
});

test("screen keeps Ads-only copy and view-as lock", () => {
  assert.doesNotMatch(screen, /All data up to date/);
  assert.doesNotMatch(screen, /KDP/);
  assert.doesNotMatch(screen, /Keep the app open/);
  assert.match(screen, /VIEWING_CUSTOMER_BANNER/);
  assert.equal(VIEWING_CUSTOMER_BANNER, "Viewing a customer. Sync now and Cancel stay off.");
  assert.match(screen, /includeSessions: !viewingCustomer/);
  assert.match(screen, /4000/);
});

test("relative timestamps stay human", () => {
  const now = Date.parse("2026-08-22T15:00:00Z");
  assert.equal(formatSyncWhen("2026-08-22T14:48:00Z", now), "12 min ago");
  assert.equal(formatSyncWhen("2026-08-22T14:48:00Z", now, { spoken: true }), "12 minutes ago");
  assert.equal(formatSyncWhen("2026-08-22T13:00:00Z", now), "2 hr ago");
});
