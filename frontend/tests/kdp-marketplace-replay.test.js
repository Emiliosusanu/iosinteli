import assert from "node:assert/strict";
import test from "node:test";

import {
  patchKdpBodyAllMarketplaces,
  patchKdpUrlAllMarketplaces,
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

test("rebuilt requests are USD; marketplace strip is a separate patch helper", () => {
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
  // rebuildTemplateForDay only patches currency/dates; all-marketplace strip is patchKdpBodyAllMarketplaces.
  assert.deepEqual(JSON.parse(body.filterBy), { MARKETPLACE: ["DE"], FORMAT: ["ebook"] });
  assert.deepEqual(
    JSON.parse(JSON.parse(patchKdpBodyAllMarketplaces(rebuilt.body)).filterBy),
    { FORMAT: ["ebook"] },
  );
});
