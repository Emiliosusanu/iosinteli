import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyCapturedUrl, hasRequiredTemplates, mergeCapturedTemplate } from "../src/lib/kdp/templates.ts";
import { parseKdpJsonOrThrow, rebuildTemplateForDay } from "../src/lib/kdp/replay.ts";
import { buildKdpFromJsons, pickTemplateTypeByUrl } from "../src/lib/kdp/vendor/kdpVendor.generated.js";

const vendor = readFileSync(new URL("../src/lib/kdp/vendor/kdpVendor.generated.js", import.meta.url), "utf8");

test("vendored parser is the full extension function, not a truncated stub", () => {
  assert.match(vendor, /function buildKdpFromJsons/);
  assert.match(vendor, /function extractBooksObj/);
  assert.match(vendor, /function buildTitlesRows/);
  assert.match(vendor, /function pickTemplateTypeByUrl/);
  const start = vendor.indexOf("function buildKdpFromJsons");
  const next = vendor.indexOf("\nfunction ", start + 10);
  assert.ok(next - start > 8000, `buildKdpFromJsons too small: ${next - start}`);
});

test("URL classifier matches the Chrome extension", () => {
  assert.equal(pickTemplateTypeByUrl("https://kdpreports.amazon.com/api/reports/royalties"), "royalties");
  assert.equal(pickTemplateTypeByUrl("https://kdpreports.amazon.com/api/reports/orders"), "orders");
  assert.equal(pickTemplateTypeByUrl("https://kdpreports.amazon.com/api/reports/kenpc"), "kenp");
  assert.equal(classifyCapturedUrl("https://kdpreports.amazon.com/metadata/reports/reportsMetadata"), "titles");
});

test("required templates are royalties + orders + kenp", () => {
  let t = {};
  assert.equal(hasRequiredTemplates(t), false);
  t = mergeCapturedTemplate(t, { url: "https://kdpreports.amazon.com/api/reports/royalties", method: "POST", requestBody: "{}" });
  t = mergeCapturedTemplate(t, { url: "https://kdpreports.amazon.com/api/reports/orders", method: "POST", requestBody: "{}" });
  t = mergeCapturedTemplate(t, { url: "https://kdpreports.amazon.com/api/reports/kenp", method: "POST", requestBody: "{}" });
  assert.equal(hasRequiredTemplates(t), true);
});

test("rebuild patches YMD dates in url and body", () => {
  const rebuilt = rebuildTemplateForDay(
    {
      type: "royalties",
      url: "https://kdpreports.amazon.com/api/reports/royalties?startDate=2026-01-01&endDate=2026-01-01",
      method: "POST",
      requestHeaders: { cookie: "secret" },
      requestBody: JSON.stringify({ startDate: "2026-01-01", endDate: "2026-01-01" }),
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    "royalties",
    "2026-09-02",
  );
  assert.match(rebuilt.url, /2026-09-02/);
  assert.doesNotMatch(rebuilt.url, /2026-01-01/);
  assert.ok(!Object.keys(rebuilt.headers).some((k) => k.toLowerCase() === "cookie"));
  const body = JSON.parse(rebuilt.body);
  assert.equal(body.startDate.includes("2026-09-02") || body.startDate === "2026-09-02", true);
});

test("HTML logout pages are rejected", () => {
  assert.throws(
    () => parseKdpJsonOrThrow({ ok: true, status: 200, text: "<html><body>Sign in</body></html>" }, "royalties"),
    /logged out/,
  );
});

test("buildKdpFromJsons writes the same daily tables as the extension", () => {
  const built = buildKdpFromJsons({
    ymd: "2026-09-02",
    titlesJson: {
      reportsMetadata: {
        books: {
          B0TEST1234: {
            titleName: "Test Book",
            author: "A",
            asins: { digital: "B0TEST1234" },
          },
        },
      },
    },
    royaltiesJson: {
      histogram: {
        props: { preferredCurrency: "USD" },
        data: [
          {
            bin: "B0TEST1234",
            values: { TotalRoyalties: 12.5, DigitalRoyalties: 10, PagesReadRoyalties: 2.5 },
          },
        ],
      },
    },
    ordersJson: {
      histogram: { data: [{ bin: "B0TEST1234", values: { TotalOrders: 3, DigitalOrders: 3 } }] },
    },
    kenpJson: {
      histogram: { data: [{ bin: "B0TEST1234", values: { TotalKENP: 400 } }] },
    },
    adsJson: null,
  });
  assert.equal(built.rowDaily.date, "2026-09-02");
  assert.equal(built.rowDaily.royalties, 12.5);
  assert.equal(built.rowDaily.orders, 3);
  assert.equal(built.rowDaily.kenp, 400);
  assert.equal(built.rowEntry.income, 12.5);
  assert.equal(built.rowEntry.income_currency, "USD");
  assert.ok(built.rowsBookDaily.some((r) => r.asin === "B0TEST1234" && r.royalties === 12.5));
});
