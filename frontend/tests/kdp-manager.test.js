import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeKdpAndAdsBooks } from "../src/lib/kdpManager.ts";

const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");
const model = readFileSync(new URL("../src/lib/kdpManager.ts", import.meta.url), "utf8");
const screen = readFileSync(new URL("../app/more/kdp-manager.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");
const linkPreview = readFileSync(new URL("../src/lib/kdp/linkPreview.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("../app/more/settings.tsx", import.meta.url), "utf8");

test("KDP manager keeps books without covers and labels every linked Ads marketplace", () => {
  assert.match(mutations, /if \(!asin\) continue;/);
  assert.doesNotMatch(mutations, /if \(!asin \|\| !coverUrl\) continue;/);
  assert.match(model, /adsProfileIds: \[\.\.\.new Set/);
  assert.match(model, /Number\(b\.inKdp\) - Number\(a\.inKdp\)/);
});

test("KDP accounts stay visible before an Ads marketplace is linked", () => {
  assert.doesNotMatch(topBar, /if \(!items\.length\) return null/);
  assert.match(topBar, /No linked Ads marketplaces/);
});

test("dedicated manager exposes rename, books, marketplaces, and confirmed delete", () => {
  assert.match(settings, /router\.push\("\/more\/kdp-manager"/);
  assert.match(screen, /Rename KDP account/);
  assert.match(screen, /Linked marketplaces/);
  assert.match(screen, /Delete KDP book data\?/);
  assert.match(screen, /Amazon Ads campaigns and products stay unchanged/);
  assert.match(screen, /A later full KDP sync can import the book again/);
  assert.doesNotMatch(screen, /permanently removes/);
  assert.match(screen, /invalidateQueries\(\{ queryKey: \["dashboard"\]/);
});

test("catalog read includes format rows and surfaces read errors", () => {
  assert.match(linkPreview, /from\("kdp_book_formats"\)/);
  assert.match(linkPreview, /throw new Error\(`kdp_book_formats:/);
  assert.match(linkPreview, /from\("kdp_books"\)/);
});

test("KDP book deletion uses the authenticated Nest endpoint", () => {
  assert.match(mutations, /export async function deleteKdpBook/);
  assert.match(mutations, /\/kdp\/accounts\/\$\{encodeURIComponent\(kdpAccountId\)\}\/books\//);
  assert.match(mutations, /method: "DELETE"/);
});

test("book merge retains every marketplace sharing the same ASIN", () => {
  const rows = mergeKdpAndAdsBooks(
    [{ asin: "B012345678", title: "Real book", imageUrl: null }],
    [
      { profileId: "us", books: [{ asin: "B012345678", title: null, coverUrl: null }] },
      { profileId: "ca", books: [{ asin: "b012345678", title: "Real book", coverUrl: "https://cover" }] },
    ],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].inKdp, true);
  assert.deepEqual(rows[0].adsProfileIds, ["us", "ca"]);
  assert.equal(rows[0].coverUrl, "https://cover");
});
