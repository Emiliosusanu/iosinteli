/**
 * Unit tests for vendored Chrome kdp-pricing-capture + iOS candidate collection.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { collectPricingCandidatesForIos } from "../src/lib/kdp/pricingCandidates.ts";
import {
  computeKdpNetRoyalty,
  computeTargetBreakEvenAcos,
  diagnoseKdpSetupPageFailure,
  extractBookshelfPrintRowsFromHtml,
  extractKdpPricingEditorContext,
  extractPrintSetupIdsFromJsonDeep,
  isLikelyKdpPricingMutation,
  isKdpSetupPageSignInResponse,
  isKdpSetupPageTransportFailure,
  looksLikeKdpSetupBookId,
  parseKdpGetSetupPage,
  shouldClearPricingGateForTabUrl,
} from "../src/lib/kdp/vendor/kdpPricingCapture.js";

test("BE ACoS = net royalty / list price × 100 (Chrome formula)", () => {
  const net = computeKdpNetRoyalty(16.91, 2.5, [{ threshold: 0, royaltyRate: 0.6 }]);
  assert.ok(net != null);
  assert.equal(Number(net.toFixed(3)), 7.646);
  const be = computeTargetBreakEvenAcos(net, 16.91);
  assert.ok(be != null);
  assert.equal(Number(be.toFixed(2)), 45.22);
});

test("parseKdpGetSetupPage computes net and BE from get-setup-page JSON", () => {
  const pricing = parseKdpGetSetupPage(
    {
      book: { title: "Test", asin: "B0FW468FBB" },
      pricing: { US: { priceVatExclusive: 15.99, currencyCode: "USD" } },
      pricingSpec: {
        current: {
          US: {
            printingCost: 2.5,
            programs: { RETAIL: { royaltyRates: [{ threshold: 0, royaltyRate: 0.6 }] } },
          },
        },
      },
    },
    "US",
  );
  assert.equal(pricing?.asin, "B0FW468FBB");
  assert.equal(pricing?.netRoyalty, 7.094);
  assert.ok(pricing?.targetBreakEvenAcos != null);
  assert.equal(Number(pricing.targetBreakEvenAcos.toFixed(2)), 44.37);
});

test("sign-in gate detection matches Chrome", () => {
  assert.equal(
    isKdpSetupPageSignInResponse({ reason: "sign_in" }, "", 403),
    true,
  );
  assert.equal(
    isKdpSetupPageSignInResponse({ pricing: { US: { priceVatExclusive: 10 } } }, "", 200),
    false,
  );
});

test("WebKit Load failed / status-0 is a transport failure, not a silent miss", () => {
  assert.equal(
    isKdpSetupPageTransportFailure({ status: 0, text: "Load failed" }),
    true,
  );
  assert.equal(
    isKdpSetupPageTransportFailure({ status: 0, text: "Failed to fetch" }),
    true,
  );
  assert.equal(
    isKdpSetupPageTransportFailure({ status: 0, text: "" }),
    true,
  );
  assert.equal(
    isKdpSetupPageTransportFailure({ status: 404, text: "ItemSetId x is not found" }),
    false,
  );
  assert.equal(
    isKdpSetupPageTransportFailure({ status: 200, text: '{"pricing":{}}' }),
    false,
  );
  const why = diagnoseKdpSetupPageFailure({
    fetchResult: { ok: false, status: 0, text: "Load failed" },
    json: null,
    url: "https://kdp.amazon.com/en_US/print-setup/paperback/ABC123DEF45/get-setup-page",
  });
  assert.match(why, /Load failed/);
  assert.match(why, /transport failure/);
  assert.match(why, /print-setup/);
});

test("print-setup URL clears pricing gate", () => {
  assert.equal(
    shouldClearPricingGateForTabUrl(
      "https://kdp.amazon.com/en_US/print-setup/paperback/ABC123DEF45/pricing",
    ),
    true,
  );
  assert.equal(
    shouldClearPricingGateForTabUrl("https://kdpreports.amazon.com/"),
    false,
  );
});

test("collectPricingCandidatesForIos merges bookshelf HTML + format rows", () => {
  const html = `
    <div data-asin="B0GS27WQBZ">Paperback</div>
    <a href="/en_US/print-setup/paperback/2RZKVQBNHD8/pricing">Ireland</a>
  `;
  // Prefer co-located extraction via extractBookshelfPrintRowsFromHtml
  const rows = extractBookshelfPrintRowsFromHtml(`
    <div id="dual-print-price-asin-2RZKVQBNHD8">Paperback ASIN: B0GS27WQBZ</div>
    <a href="/en_US/print-setup/paperback/2RZKVQBNHD8/pricing">Ireland</a>
  `);
  assert.ok(rows.some((r) => r.kdpBookId === "2RZKVQBNHD8"));

  const { candidates } = collectPricingCandidatesForIos({
    booksObj: {
      book1: {
        titleName: "Ireland",
        asins: { print: "B0GS27WQBZ" },
        printSetupIds: { paperback: "2RZKVQBNHD8" },
      },
    },
    formatRows: [{ asin: "B0GS27WQBZ", format: "paperback" }],
    titlesJson: null,
    bookshelfHtml: html,
    storedSetupByAsin: new Map(),
  });
  assert.ok(candidates.some((c) => c.kdpBookId === "2RZKVQBNHD8" && c.asin === "B0GS27WQBZ"));
  assert.ok(looksLikeKdpSetupBookId("2RZKVQBNHD8"));
});

test("live Bookshelf setup ID replaces stale stored ID for the same ASIN", () => {
  const { candidates } = collectPricingCandidatesForIos({
    booksObj: {
      stale: {
        titleName: "Recreated paperback",
        asins: { print: "B0GS27WQBZ" },
        printSetupIds: { paperback: "OLDSETUP123" },
      },
    },
    formatRows: [{ asin: "B0GS27WQBZ", format: "paperback" }],
    titlesJson: null,
    bookshelfHtml: `
      <div>Paperback ASIN: B0GS27WQBZ</div>
      <a href="/en_US/print-setup/paperback/NEWSETUP456/pricing">Rights & Pricing</a>
    `,
    storedSetupByAsin: new Map([["B0GS27WQBZ", "OLDSETUP123"]]),
  });
  const paired = candidates.filter((row) => row.asin === "B0GS27WQBZ");
  assert.deepEqual(paired.map((row) => row.kdpBookId), ["NEWSETUP456"]);
});

test("extractPrintSetupIdsFromJsonDeep finds nested setup ids", () => {
  const links = extractPrintSetupIdsFromJsonDeep({
    nested: { id: "P3BWZSWT3DH", printAsin: "B0F6D8BSP4" },
  });
  assert.ok(links.some((l) => l.kdpBookId === "P3BWZSWT3DH"));
});

test("pricing editor context + save mutation match Chrome", () => {
  const pageUrl =
    "https://kdp.amazon.com/en_US/print-setup/paperback/2RZKVQBNHD8/pricing";
  const ctx = extractKdpPricingEditorContext(pageUrl);
  assert.equal(ctx?.setupId, "2RZKVQBNHD8");
  assert.equal(ctx?.pricingRoute, true);
  assert.equal(
    isLikelyKdpPricingMutation({
      pageUrl,
      requestUrl: "/en_US/print-setup/paperback/2RZKVQBNHD8/save-setup",
      method: "POST",
      body: '{"listPrice":19.99}',
    }),
    true,
  );
  assert.equal(
    isLikelyKdpPricingMutation({
      pageUrl,
      requestUrl: "/telemetry",
      method: "POST",
      body: "{}",
    }),
    false,
  );
});
