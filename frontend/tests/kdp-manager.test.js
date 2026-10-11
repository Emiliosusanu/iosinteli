import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeKdpAndAdsBooks, splitKdpAndAdsBooks } from "../src/lib/kdpManager.ts";
import { authoritativeKdpCatalog } from "../src/lib/kdp/catalogAuthority.ts";

const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");
const model = readFileSync(new URL("../src/lib/kdpManager.ts", import.meta.url), "utf8");
const screen = readFileSync(new URL("../app/more/kdp-manager.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");
const linkPreview = readFileSync(new URL("../src/lib/kdp/linkPreview.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("../app/more/settings.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");

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
  assert.match(screen, /testID={`open-kdp-book-\$\{book\.asin\}`}/);
  assert.match(screen, /pathname: "\/product\/\[asin\]"/);
  assert.match(screen, /accessibilityHint="Opens book details"/);
  assert.match(topBar, /testID={`view-kdp-books-\$\{account\.id\}`}/);
  assert.match(topBar, /setProfileOpen\(false\);[\s\S]*pathname: "\/more\/kdp-manager"/);
  assert.match(topBar, /onDismiss={finishProfileDismiss}/);
  assert.match(screen, /useLocalSearchParams<\{ accountId\?/);
  assert.match(screen, /accountsQ\.data\.find\(\(row\) => row\.id === requestedAccountId\)/);
  assert.match(screen, /kdp-manager-catalog-counts/);
  assert.match(screen, /authoritativeBookCount/);
  assert.doesNotMatch(screen, /account\.book_count/);
});

test("Home exposes KDP Manager while Targets keeps its profile picker Ads-scoped", () => {
  assert.match(home, /testID="home-kdp-manager"/);
  assert.match(home, /router\.push\("\/more\/kdp-manager" as Href\)/);
  assert.match(home, /Manage KDP accounts and books/);
  assert.match(targeting, /<TopBar showKdpAccountGroups=\{false\} \/>/);
  assert.match(topBar, /showKdpAccountGroups \? \(/);
});

test("catalog read includes format rows and surfaces read errors", () => {
  assert.match(linkPreview, /from\("kdp_book_formats"\)/);
  assert.match(linkPreview, /throw new Error\(`kdp_book_formats:/);
  assert.match(linkPreview, /from\("kdp_books"\)/);
  assert.match(linkPreview, /loadKdpAsinQuarantineEntries/);
});

test("format shelf excludes residual title rows while legacy shelves keep titles", () => {
  const titleRows = [
    { asin: "B000000001", title: "Current", imageUrl: "title-cover" },
    { asin: "B000000002", title: "Residual", imageUrl: null },
  ];
  const current = authoritativeKdpCatalog(titleRows, [
    { asin: "B000000001", title: null, imageUrl: "format-cover" },
  ]);
  assert.deepEqual(current, [
    { asin: "B000000001", title: "Current", imageUrl: "title-cover" },
  ]);
  assert.deepEqual(
    authoritativeKdpCatalog(titleRows, []).map((row) => row.asin),
    ["B000000001", "B000000002"],
  );
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

test("KDP manager separates exact account catalog from Ads-only products", () => {
  const result = splitKdpAndAdsBooks(
    [{ asin: "B012345678", title: "KDP book", imageUrl: null }],
    [{ profileId: "us", books: [
      { asin: "B012345678", title: "KDP book", coverUrl: null },
      { asin: "B087654321", title: "Ads only", coverUrl: null },
    ] }],
  );
  assert.deepEqual(result.kdpBooks.map((row) => row.asin), ["B012345678"]);
  assert.deepEqual(result.advertisedOnly.map((row) => row.asin), ["B087654321"]);
  assert.match(screen, /Advertised in linked marketplaces/);
  assert.match(screen, /not stored in this KDP catalog/);
  assert.match(screen, /Also stored in/);
});
