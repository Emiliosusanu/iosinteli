import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { summarizeLinkPreview } from "../src/lib/kdp/linkPreviewCompare.ts";

test("summarizeLinkPreview reports match when ASINs overlap", () => {
  const summary = summarizeLinkPreview({
    helperAccountId: "acc-emi",
    helperAccountName: "emi usd 2",
    kdpBooks: [{ asin: "B0F8QGHL3P", title: "Croatia", imageUrl: null }],
    adsProfiles: [
      {
        profileId: "ads-1",
        label: "Ads HR",
        books: [{ asin: "B0F8QGHL3P", title: "Croatia", imageUrl: null }],
      },
    ],
    sharedAsins: ["B0F8QGHL3P"],
    sharedBooks: [{ asin: "B0F8QGHL3P", title: "Croatia", imageUrl: null }],
    kdpOnlyAsins: [],
    adsOnlyAsins: [],
  });
  assert.equal(summary.status, "matched");
  assert.match(summary.detail, /1 book/);
});

test("summarizeLinkPreview reports no overlap without shared ASINs", () => {
  const summary = summarizeLinkPreview({
    helperAccountId: "acc-vp",
    helperAccountName: "vp Test 1",
    kdpBooks: [{ asin: "B0OTHER001", title: "Other", imageUrl: null }],
    adsProfiles: [
      {
        profileId: "ads-1",
        label: "Ads HR",
        books: [{ asin: "B0F8QGHL3P", title: "Croatia", imageUrl: null }],
      },
    ],
    sharedAsins: [],
    sharedBooks: [],
    kdpOnlyAsins: ["B0OTHER001"],
    adsOnlyAsins: ["B0F8QGHL3P"],
  });
  assert.equal(summary.status, "no_overlap");
  assert.match(summary.detail, /ASIN/i);
});

test("summarizeLinkPreview needs helper and Ads", () => {
  assert.equal(
    summarizeLinkPreview({
      helperAccountId: null,
      helperAccountName: null,
      kdpBooks: [],
      adsProfiles: [],
      sharedAsins: [],
      sharedBooks: [],
      kdpOnlyAsins: [],
      adsOnlyAsins: [],
    }).status,
    "no_helper",
  );
  assert.equal(
    summarizeLinkPreview({
      helperAccountId: "acc",
      helperAccountName: "x",
      kdpBooks: [],
      adsProfiles: [],
      sharedAsins: [],
      sharedBooks: [],
      kdpOnlyAsins: [],
      adsOnlyAsins: [],
    }).status,
    "no_ads",
  );
});

test("Helper ↔ Ads books preview screen still fetches overlap", () => {
  const settings = readFileSync(new URL("../app/more/settings.tsx", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../app/more/kdp-link-preview.tsx", import.meta.url), "utf8");
  const linkPreview = readFileSync(new URL("../src/lib/kdp/linkPreview.ts", import.meta.url), "utf8");
  // Settings routes to KDP source / helper; overlap preview lives on its own screen.
  assert.match(settings, /settings-kdp-source/);
  assert.match(settings, /settings-kdp-helper/);
  assert.match(screen, /fetchKdpAdsLinkPreview/);
  assert.match(screen, /sharedBooks/);
  assert.match(linkPreview, /export async function fetchKdpAdsLinkPreview/);
});
