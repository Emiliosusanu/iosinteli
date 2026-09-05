import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_KDP_REPLAY_CURRENCY,
  normalizeKdpReplayCurrency,
  patchKdpBodyCurrency,
  patchKdpUrlCurrency,
  preferredCurrencyFromProfiles,
  preferredCurrencyFromTemplates,
  resolvePreferredReplayCurrency,
} from "../src/lib/kdp/currency.ts";
import { rebuildTemplateForDay } from "../src/lib/kdp/replay.ts";

test("preferred currency prefers EUR when mixed Ads profiles are selected", () => {
  assert.equal(normalizeKdpReplayCurrency("eur"), "EUR");
  assert.equal(normalizeKdpReplayCurrency("GBP"), null);
  assert.equal(DEFAULT_KDP_REPLAY_CURRENCY, "USD");
  assert.equal(
    preferredCurrencyFromProfiles([{ currency_code: "USD" }, { currency_code: "EUR" }]),
    "EUR",
  );
  assert.equal(preferredCurrencyFromProfiles([{ currency_code: "USD" }]), "USD");
  assert.equal(
    preferredCurrencyFromTemplates({
      royalties: {
        url: "/reports/royalties/table/titles",
        requestBody: JSON.stringify({ preferredCurrency: "EUR" }),
      },
    }),
    "EUR",
  );
  assert.equal(
    resolvePreferredReplayCurrency({
      profiles: [{ currency_code: "EUR" }],
      templates: {
        royalties: { url: "?preferredCurrency=USD", requestBody: null },
      },
      saved: "USD",
    }),
    "EUR",
  );
  assert.equal(
    resolvePreferredReplayCurrency({ profiles: [], templates: {}, saved: null }),
    "USD",
  );
});

test("replay patches preferredCurrency in URL and JSON body like Royaltix", () => {
  assert.equal(
    patchKdpUrlCurrency(
      "https://kdpreports.amazon.com/x?preferredCurrency=USD&startDate=2026-01-01",
      "EUR",
    ),
    "https://kdpreports.amazon.com/x?preferredCurrency=EUR&startDate=2026-01-01",
  );
  assert.match(
    patchKdpUrlCurrency("https://kdpreports.amazon.com/reports/royalties?startDate=2026-01-01", "EUR"),
    /preferredCurrency=EUR/,
  );
  const body = patchKdpBodyCurrency(
    JSON.stringify({ histogram: { props: { preferredCurrency: "USD", nested: { currencyCode: "USD" } } } }),
    "EUR",
  );
  assert.match(String(body), /"preferredCurrency":"EUR"/);
  assert.match(String(body), /"currencyCode":"EUR"/);
  const injected = patchKdpBodyCurrency(JSON.stringify({ startDate: "2026-01-01" }), "USD");
  assert.match(String(injected), /"preferredCurrency":"USD"/);

  const rebuilt = rebuildTemplateForDay(
    {
      type: "royalties",
      url: "https://kdpreports.amazon.com/reports/royalties/marketplaceOverview?preferredCurrency=USD",
      method: "POST",
      requestHeaders: {},
      requestBody: JSON.stringify({
        startDate: "2026-01-01",
        endDate: "2026-01-01",
        preferredCurrency: "USD",
      }),
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    "royalties",
    "2026-09-02",
    { preferredCurrency: "EUR" },
  );
  assert.match(rebuilt.url, /preferredCurrency=EUR/);
  assert.match(String(rebuilt.body), /"preferredCurrency":"EUR"/);
});
