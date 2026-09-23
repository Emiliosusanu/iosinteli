import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  advertisedAsinForCreateFormat,
  createFlowFormatOptions,
  defaultCreateFormatAsin,
  formatsFromWorkKey,
  preferredEnabledProfileId,
} from "../src/lib/bookCampaignFormats.ts";

const create = readFileSync(new URL("../app/campaign/create.tsx", import.meta.url), "utf8");

test("formatsFromWorkKey lists only encoded formats", () => {
  const formats = formatsFromWorkKey(
    "DIGITAL=B0KINDLE01:PRINT=B0PRINT001:HARDCOVER=B0HARD001:AUDIO=B0AUDIO001::",
  );
  assert.deepEqual(
    formats.map((f) => f.kind),
    ["kindle", "paperback", "hardcover", "audiobook"],
  );
  assert.equal(defaultCreateFormatAsin(formats), "B0PRINT001");
});

test("createFlowFormatOptions hides audiobook chips", () => {
  const formats = formatsFromWorkKey(
    "DIGITAL=B0KINDLE01:PRINT=B0PRINT001:HARDCOVER=B0HARD001:AUDIO=B0AUDIO001::",
  );
  assert.deepEqual(
    createFlowFormatOptions(formats).map((f) => f.kind),
    ["kindle", "paperback", "hardcover"],
  );
});

test("advertisedAsinForCreateFormat remaps Kindle/Hardcover to PRINT", () => {
  const formats = formatsFromWorkKey(
    "DIGITAL=B0KINDLE01:PRINT=B0PRINT001:HARDCOVER=B0HARD001::",
  );
  const kindle = formats.find((f) => f.kind === "kindle");
  const hardcover = formats.find((f) => f.kind === "hardcover");
  const paperback = formats.find((f) => f.kind === "paperback");
  assert.equal(advertisedAsinForCreateFormat(kindle, formats), "B0PRINT001");
  assert.equal(advertisedAsinForCreateFormat(hardcover, formats), "B0PRINT001");
  assert.equal(advertisedAsinForCreateFormat(paperback, formats), "B0PRINT001");
});

test("advertisedAsinForCreateFormat keeps Kindle when PRINT missing", () => {
  const formats = formatsFromWorkKey("DIGITAL=B0KINDLE01::");
  assert.equal(
    advertisedAsinForCreateFormat(formats[0], formats),
    "B0KINDLE01",
  );
});

test("defaultCreateFormatAsin falls back when paperback missing", () => {
  assert.equal(defaultCreateFormatAsin(formatsFromWorkKey("DIGITAL=B0KINDLE01::")), "B0KINDLE01");
  assert.equal(defaultCreateFormatAsin([]), null);
});

test("preferredEnabledProfileId skips Disabled profiles", () => {
  const id = preferredEnabledProfileId(
    [
      { id: "hr", profile_id: "ads-hr", is_enabled: false, country_code: "HR" },
      { id: "us", profile_id: "ads-us", is_enabled: true, country_code: "US" },
    ],
    "HR",
  );
  assert.equal(id, "us");
});

test("preferredEnabledProfileId prefers book-linked Ads ids over first US match", () => {
  const id = preferredEnabledProfileId(
    [
      { id: "emilian", profile_id: "2543611550477751", is_enabled: true, country_code: "US" },
      { id: "vp2", profile_id: "3423496215225846", is_enabled: true, country_code: "US" },
      { id: "ca", profile_id: "3896545512891020", is_enabled: true, country_code: "CA" },
    ],
    "US",
    ["3896545512891020", "3423496215225846"],
  );
  assert.equal(id, "vp2");
});

test("Create campaign format chips switch exclusively without forcing PRINT highlight", () => {
  assert.match(create, /useLocalSearchParams/);
  assert.match(create, /prefAsin/);
  assert.match(create, /prefProfileId/);
  assert.match(create, /prefillFormats/);
  assert.match(create, /selectedFormatAsin/);
  assert.match(create, /setSelectedFormatAsin/);
  assert.match(create, /advertisedAsinForCreateFormat/);
  assert.match(create, /createFlowFormatOptions/);
  assert.match(create, /forceFallback=\{prefillFormats\.length > 2\}/);
  assert.match(create, /Ads use paperback/);
  assert.doesNotMatch(create, /Always highlight PRINT for SP create/);
  assert.match(create, /searchCreatePaperbacks/);
  assert.match(create, /adsStockSoftListed/);
});

test("Products targeting auto-fetches suggestions with explicit targeting arg", () => {
  assert.match(create, /previewM\.mutate\(type\)/);
  assert.match(create, /mutationFn: \(nextTargeting\?: CampaignCreationTargeting\)/);
  assert.match(create, /Paste ASINs below to continue/);
  assert.match(create, /Loading product suggestions/);
});
