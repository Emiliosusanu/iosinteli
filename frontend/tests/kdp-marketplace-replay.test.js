import assert from "node:assert/strict";
import test from "node:test";

import {
  patchKdpBodyAllMarketplaces,
  patchKdpUrlAllMarketplaces,
  resolveKdpMarketplaceTarget,
} from "../src/lib/kdp/marketplace.ts";
import { rebuildTemplateForDay } from "../src/lib/kdp/replay.ts";

test("KDP replay removes marketplace from string and object filterBy values", () => {
  const body = JSON.stringify({
    report: {
      filterBy: JSON.stringify({ MARKETPLACE: ["US"], FORMAT: ["ebook"] }),
      nested: { filterBy: { marketplace: ["CA"], language: ["en"] } },
    },
  });
  const patched = JSON.parse(patchKdpBodyAllMarketplaces(body));
  assert.deepEqual(JSON.parse(patched.report.filterBy), { FORMAT: ["ebook"] });
  assert.deepEqual(patched.report.nested.filterBy, { language: ["en"] });
});

test("KDP replay URL removes only marketplace inside filterBy", () => {
  const url = new URL("https://kdpreports.amazon.com/api/reports/royalties");
  url.searchParams.set("filterBy", JSON.stringify({ MARKETPLACE: ["US"], FORMAT: ["paperback"] }));
  url.searchParams.set("account", "seller-1");
  const patched = new URL(patchKdpUrlAllMarketplaces(url.toString()));
  assert.deepEqual(JSON.parse(patched.searchParams.get("filterBy")), { FORMAT: ["paperback"] });
  assert.equal(patched.searchParams.get("account"), "seller-1");
});

test("rebuilt All requests are USD and cannot retain the captured marketplace", () => {
  const rebuilt = rebuildTemplateForDay(
    {
      url: "https://kdpreports.amazon.com/api/reports/royalties?from=2026-01-01&to=2026-01-01",
      method: "POST",
      requestHeaders: {},
      requestBody: JSON.stringify({
        startDate: "2026-01-01",
        endDate: "2026-01-01",
        preferredCurrency: "EUR",
        filterBy: JSON.stringify({ MARKETPLACE: ["DE"], FORMAT: ["ebook"] }),
      }),
    },
    "royalties",
    "2026-09-20",
    { preferredCurrency: "USD" },
  );
  const body = JSON.parse(rebuilt.body);
  assert.equal(body.preferredCurrency, "USD");
  assert.deepEqual(JSON.parse(body.filterBy), { FORMAT: ["ebook"] });
});

test("rebuilt native requests set exact marketplace and native currency", () => {
  const target = resolveKdpMarketplaceTarget("UK");
  assert.deepEqual(target, { key: "GB", filterToken: "Amazon.co.uk", currency: "GBP" });
  const rebuilt = rebuildTemplateForDay(
    {
      url: "https://kdpreports.amazon.com/api/reports/royalties",
      method: "POST",
      requestHeaders: {},
      requestBody: JSON.stringify({ filterBy: JSON.stringify({ MARKETPLACE: ["Amazon.de"] }) }),
    },
    "royalties",
    "2026-10-07",
    { preferredCurrency: "GBP", marketplace: target },
  );
  const body = JSON.parse(rebuilt.body);
  assert.equal(body.preferredCurrency, "GBP");
  assert.deepEqual(JSON.parse(body.filterBy), { MARKETPLACE: ["Amazon.co.uk"] });
});
