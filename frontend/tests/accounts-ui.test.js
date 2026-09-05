import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DISABLE_CONFIRM_MESSAGE,
  ENABLE_PROFILE_FAILED_TITLE,
  KDP_SECTION_FOOTER,
  NEST_DISABLED_VIEW_MESSAGE,
  PROFILE_LIST_ALL_LABEL,
  PROFILE_LIST_READY_LABEL,
  adsAccountFamilyName,
  adsAccountGroupHeading,
  adsAccountGroupTitle,
  countryFlagEmoji,
  enableProfileFailedBody,
  enableProfileFailedTitle,
  isTransientEnableProfileError,
  profileAssociationHint,
  enabledStatusLabel,
  filterProfilesBySheetMode,
  groupProfilesByAdsAccount,
  isReadyToEnable,
  matchesReadyDefaultFilter,
  multiCountryFlagIcons,
  displayCurrencyOfSelection,
  planSelectAllSameCurrency,
  planViewToggle,
  profileEnabled,
  profileInView,
  profileRowAccessibilityLabel,
  profileSwitchAccessibilityLabel,
  shortAdsAccountId,
  viewStatusLabel,
} from "../src/lib/accountsUi.ts";

const screen = readFileSync(new URL("../app/more/accounts.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");
const appContext = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");

test("enable switch is Enabled/Disabled, not Connected, and is not view selection", () => {
  assert.equal(enabledStatusLabel(true), "Enabled");
  assert.equal(enabledStatusLabel(false), "Disabled");
  assert.equal(viewStatusLabel(true), "In view");
  assert.equal(viewStatusLabel(false), "—");
  assert.equal(profileEnabled({ is_enabled: undefined }), true);
  assert.equal(profileEnabled({ is_enabled: false }), false);
  assert.equal(profileInView({ id: "a", profile_id: "a" }, ["a"]), true);
  assert.equal(profileInView({ id: "uuid", profile_id: "ads-1" }, ["ads-1"]), true);
  assert.equal(profileInView({ id: "a", profile_id: "a" }, ["b"]), false);
  assert.match(screen, /value=\{enabled\}/);
  assert.match(screen, /enabledStatusLabel/);
  assert.match(screen, /account-view-/);
  assert.match(screen, /VIEW_ADD_HINT/);
  assert.match(screen, /profilesQueryKey/);
  assert.match(screen, /onMutate/);
  assert.match(screen, /setQueryData/);
  assert.match(screen, /rowId/);
  assert.match(screen, /adsProfileId/);
  // Enable flips is_enabled only; view selection stays on the chip (no toggleProfile(rowId)).
  assert.doesNotMatch(screen, /toggleProfile\(rowId\)/);
  assert.doesNotMatch(screen, /Connected/);
  assert.doesNotMatch(screen, /disconnect Amazon account|Disconnect Amazon/i);
  assert.doesNotMatch(screen, /Synced/);
});

test("ready default uses campaigns_enabled_count, not total campaign_count alone", () => {
  assert.equal(isReadyToEnable({ campaigns_enabled_count: 2 }), true);
  assert.equal(isReadyToEnable({ campaigns_enabled_count: 0 }), false);
  assert.equal(isReadyToEnable({}), false);
  assert.equal(matchesReadyDefaultFilter({ campaigns_enabled_count: 0, is_enabled: true }), true);
  assert.equal(matchesReadyDefaultFilter({ campaigns_enabled_count: 1, is_enabled: false }), true);
  assert.equal(matchesReadyDefaultFilter({ campaigns_enabled_count: 0, is_enabled: false }), false);
  assert.deepEqual(
    filterProfilesBySheetMode(
      [
        { id: "1", profile_id: "1", campaigns_enabled_count: 0, is_enabled: false, account_name: "A", account_id: "other", nickname: null, country_code: "US", currency_code: "USD", marketplace_id: null, account_type: null, created_at: "", updated_at: "" },
        { id: "2", profile_id: "2", campaigns_enabled_count: 3, is_enabled: false, account_name: "B", account_id: "ready-acct", nickname: null, country_code: "CA", currency_code: "CAD", marketplace_id: null, account_type: null, created_at: "", updated_at: "" },
      ],
      "ready",
    ).map((p) => p.id),
    ["2"],
  );
  const readyWithSibling = filterProfilesBySheetMode(
    [
      { id: "1", profile_id: "1", campaigns_enabled_count: 3, is_enabled: true, account_name: "Author - US", account_id: "x", nickname: "US", country_code: "US", currency_code: "USD", marketplace_id: null, account_type: null, created_at: "", updated_at: "" },
      { id: "2", profile_id: "2", campaigns_enabled_count: 0, is_enabled: false, account_name: "Author - CA", account_id: "x", nickname: "CA", country_code: "CA", currency_code: "CAD", marketplace_id: null, account_type: null, created_at: "", updated_at: "" },
    ],
    "ready",
  );
  assert.deepEqual(readyWithSibling.map((p) => p.id).sort(), ["1", "2"]);
  assert.match(mutations, /campaigns_enabled_count: enabled/);
  assert.match(mutations, /campaignsEnabledCount/);
  assert.match(screen, /PROFILE_LIST_READY_LABEL|Ready to enable/);
  assert.match(topBar, /profiles-filter-ready/);
  assert.match(topBar, /listMode/);
  assert.equal(PROFILE_LIST_READY_LABEL, "Ready");
  assert.equal(PROFILE_LIST_ALL_LABEL, "All profiles");
});

test("select-all includes every Nest-enabled marketplace and skips Nest-off profiles", () => {
  const profiles = [
    {
      id: "us",
      profile_id: "us-ads",
      account_name: "US",
      account_id: "E",
      nickname: null,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: null,
      account_type: null,
      is_enabled: true,
      campaigns_enabled_count: 2,
      created_at: "",
      updated_at: "",
    },
    {
      id: "us2",
      profile_id: "us2-ads",
      account_name: "US 2",
      account_id: "E2",
      nickname: null,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: null,
      account_type: null,
      is_enabled: true,
      campaigns_enabled_count: 1,
      created_at: "",
      updated_at: "",
    },
    {
      id: "uk",
      profile_id: "uk-ads",
      account_name: "UK",
      account_id: "E",
      nickname: null,
      country_code: "UK",
      currency_code: "GBP",
      marketplace_id: null,
      account_type: null,
      is_enabled: true,
      campaigns_enabled_count: 1,
      created_at: "",
      updated_at: "",
    },
    {
      id: "us-off",
      profile_id: "us-off-ads",
      account_name: "US off",
      account_id: "E",
      nickname: null,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: null,
      account_type: null,
      is_enabled: false,
      campaigns_enabled_count: 4,
      created_at: "",
      updated_at: "",
    },
  ];
  assert.deepEqual(planSelectAllSameCurrency({ profiles, selectedProfileIds: ["us"] }), ["us", "us2", "uk"]);
  assert.deepEqual(planSelectAllSameCurrency({ profiles, selectedProfileIds: [] }), ["us", "us2", "uk"]);
  assert.deepEqual(planSelectAllSameCurrency({ profiles, selectedProfileIds: ["uk"] }), ["us", "us2", "uk"]);
  assert.match(readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8"), /planSelectAllEnabled/);
});

test("CAD joins a USD view and the reporting chip stays USD", () => {
  const profiles = [
    {
      id: "us",
      profile_id: "us-ads",
      account_name: "Sponsored ads - Author - US",
      account_id: "ENTITY1",
      nickname: null,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: null,
      account_type: null,
      is_enabled: true,
      campaigns_enabled_count: 2,
      created_at: "",
      updated_at: "",
    },
    {
      id: "ca",
      profile_id: "ca-ads",
      account_name: "Sponsored ads - Author - CA",
      account_id: "ENTITY1",
      nickname: null,
      country_code: "CA",
      currency_code: "CAD",
      marketplace_id: null,
      account_type: null,
      is_enabled: true,
      campaigns_enabled_count: 1,
      created_at: "",
      updated_at: "",
    },
  ];
  const plan = planViewToggle({
    profileId: "ca",
    profiles,
    selectedProfileIds: ["us"],
  });
  assert.equal(plan.kind, "add");
  if (plan.kind === "add") {
    assert.deepEqual(plan.nextIds, ["us", "ca"]);
  }
  assert.equal(displayCurrencyOfSelection(profiles, ["us", "ca"]), "USD");
  assert.match(appContext, /planViewToggle/);
  assert.match(appContext, /displayCurrencyOfSelection/);
  assert.doesNotMatch(appContext, /VIEW_CURRENCY_CONFLICT_TITLE|currency_conflict/);
});

test("Nest-disabled profiles cannot stay selected in view planner", () => {
  const plan = planViewToggle({
    profileId: "off",
    profiles: [
      {
        id: "off",
        profile_id: "off-ads",
        account_name: "Off",
        account_id: "E",
        nickname: null,
        country_code: "US",
        currency_code: "USD",
        marketplace_id: null,
        account_type: null,
        is_enabled: false,
        campaigns_enabled_count: 4,
        created_at: "",
        updated_at: "",
      },
    ],
    selectedProfileIds: [],
  });
  assert.equal(plan.kind, "nest_disabled");
  assert.match(appContext, /NEST_DISABLED_VIEW/);
  assert.equal(NEST_DISABLED_VIEW_MESSAGE, "Enable in Amazon Accounts first");
  assert.match(topBar, /Amazon Accounts/);
});

test("US+CA same Ads entity share one group header", () => {
  assert.equal(shortAdsAccountId("ENTITYLONG123"), "…ONG123");
  const groups = groupProfilesByAdsAccount([
    {
      id: "us",
      profile_id: "us",
      account_id: "ENTITYLONG123",
      account_name: "Author Ads",
      nickname: "US",
      country_code: "US",
      currency_code: "USD",
      marketplace_id: null,
      account_type: null,
      campaigns_enabled_count: 1,
      is_enabled: true,
      created_at: "",
      updated_at: "",
    },
    {
      id: "ca",
      profile_id: "ca",
      account_id: "ENTITYLONG123",
      account_name: "Author Ads",
      nickname: "CA",
      country_code: "CA",
      currency_code: "CAD",
      marketplace_id: null,
      account_type: null,
      campaigns_enabled_count: 1,
      is_enabled: false,
      created_at: "",
      updated_at: "",
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(adsAccountGroupTitle(groups[0].items[0]), "Author Ads (…ONG123)");
  assert.match(adsAccountGroupHeading(groups[0]), /🇺🇸/);
  assert.match(adsAccountGroupHeading(groups[0]), /🇨🇦/);
  assert.match(profileAssociationHint(groups[0].items[1], groups[0].items), /Same Ads account as US \(US\)/);
  assert.match(profileAssociationHint(groups[0].items[1], groups[0].items), /Plan may block extra countries/);
  assert.equal(adsAccountFamilyName("Sponsored ads - Author - CA"), "Sponsored ads - Author");
  const named = groupProfilesByAdsAccount([
    {
      id: "us2",
      profile_id: "us2",
      account_id: null,
      account_name: "Sponsored ads - Author - US",
      nickname: "US",
      country_code: "US",
      currency_code: "USD",
      marketplace_id: null,
      account_type: null,
      campaigns_enabled_count: 1,
      is_enabled: true,
      created_at: "",
      updated_at: "",
    },
    {
      id: "ca2",
      profile_id: "ca2",
      account_id: null,
      account_name: "Sponsored ads - Author - CA",
      nickname: "CA",
      country_code: "CA",
      currency_code: "CAD",
      marketplace_id: null,
      account_type: null,
      campaigns_enabled_count: 0,
      is_enabled: false,
      created_at: "",
      updated_at: "",
    },
  ]);
  assert.equal(named.length, 1);
  assert.equal(named[0].items.length, 2);
  assert.match(screen, /groupProfilesByAdsAccount/);
  assert.match(topBar, /groupProfilesByAdsAccount/);
  assert.match(screen, /profileAssociationHint/);
  assert.match(topBar, /adsAccountGroupHeading/);
});

test("enable failure uses honest Nest title and preserves country-limit body", () => {
  assert.equal(ENABLE_PROFILE_FAILED_TITLE, "Couldn't enable profile");
  assert.equal(
    enableProfileFailedTitle("Your plan allows up to 1 countries. You're trying to enable profiles from 2 countries (US, CA)."),
    "Plan country limit",
  );
  assert.equal(enableProfileFailedTitle("Couldn't update profile."), ENABLE_PROFILE_FAILED_TITLE);
  assert.equal(
    isTransientEnableProfileError("Rule data is temporarily unavailable. Please try again."),
    true,
  );
  assert.equal(isTransientEnableProfileError("Your plan allows up to 1 countries."), false);
  assert.match(
    enableProfileFailedBody("Rule data is temporarily unavailable. Please try again."),
    /not left enabled/,
  );
  assert.match(screen, /enableProfileFailedTitle/);
  assert.match(screen, /enableProfileFailedBody/);
  assert.match(screen, /userMessageForNestError/);
  assert.match(mutations, /\/amazon\/profiles\/\$\{encodeURIComponent\(adsId\)\}\/books/);
  assert.match(mutations, /nestToggleProfileEnabled/);
  assert.match(mutations, /isTransientEnableProfileError/);
});

test("row speech includes name, enabled, and view without raw ids", () => {
  assert.equal(
    profileRowAccessibilityLabel({
      name: "UK Ads",
      marketplace: "United Kingdom",
      currency: "British Pounds",
      enabled: true,
      inView: false,
    }),
    "UK Ads. United Kingdom. British Pounds. Enabled. —",
  );
  assert.equal(profileSwitchAccessibilityLabel("UK Ads", false), "UK Ads. Disabled");
  assert.equal(KDP_SECTION_FOOTER, "");
  assert.match(DISABLE_CONFIRM_MESSAGE, /Does not disconnect Amazon/);
  assert.equal(countryFlagEmoji("US"), "🇺🇸");
  assert.equal(countryFlagEmoji("CA"), "🇨🇦");
  assert.deepEqual(
    multiCountryFlagIcons(
      [
        { country_code: "US", is_enabled: true },
        { country_code: "CA", is_enabled: true },
        { country_code: "US", is_enabled: true },
        { country_code: "UK", is_enabled: false },
      ],
      { onlyEnabled: true },
    ),
    ["🇺🇸", "🇨🇦"],
  );
});

test("distinct empty and error copy", () => {
  assert.match(screen, /No Amazon profiles/);
  assert.match(screen, /Couldn't load Amazon profiles/);
  assert.match(screen, /No KDP accounts/);
  assert.match(screen, /Couldn't load KDP accounts/);
  assert.match(screen, /Connect Amazon Ads/);
  assert.match(screen, /None ready/);
  assert.match(screen, /\{enabledCount\} enabled · \{viewCount\} in view/);
  assert.match(screen, /Royalty source/);
  assert.doesNotMatch(screen, /iPhone does not collect KDP/);
  assert.doesNotMatch(screen, /No data/);
  assert.match(screen, /accounts-viewing-customer/);
  assert.match(screen, /accounts-guest/);
  assert.match(topBar, /None ready/);
  assert.doesNotMatch(topBar, /Switches choose the current dashboard view/);
});
