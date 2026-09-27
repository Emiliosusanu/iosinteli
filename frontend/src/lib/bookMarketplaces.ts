/**
 * Same logical book across Amazon marketplaces (US + CA, …).
 * Flags are shown only when that book is actually sponsored in 2+ countries.
 */

export type MarketplaceProfileRef = {
  id?: string | null;
  profile_id?: string | null;
  country_code?: string | null;
};

export type MarketplaceCampaignRef = {
  id?: string | null;
  name?: string | null;
  state?: string | null;
  amazon_profile_id?: string | null;
  book_key?: string | null;
  book_asin?: string | null;
  book_title?: string | null;
};

export type MarketplaceProductAdRef = {
  campaign_id?: string | null;
  asin?: string | null;
  sku?: string | null;
  title?: string | null;
  amazon_profile_id?: string | null;
};

export type SponsoredBookRef = {
  title?: string | null;
  asin?: string | null;
  sku?: string | null;
  book_key?: string | null;
};

export type MarketplaceCampaignBookRef = {
  asin?: string | null;
  campaignIds?: readonly string[] | null;
};

export type SponsoredMarketplaceIndex = {
  countriesByKey: Map<string, Set<string>>;
  keysByCampaignId: Map<string, Set<string>>;
};

const MARKETPLACE_SUFFIX =
  /\s*[-–—]\s*(US|CA|UK|GB|DE|FR|IT|ES|JP|AU|MX|IN|AE|NL|SE|PL|BE|TR|SG|BR)\s*$/i;

const TARGETING_SUFFIX =
  /\s*[-–—|:]\s*(auto|automatic|asin|asins|keyword|keywords|manual|product|exact|phrase|broad|pt|product targeting)\s*$/i;

const FAMILY_STOP = new Set([
  "auto",
  "automatic",
  "asin",
  "asins",
  "keyword",
  "keywords",
  "manual",
  "product",
  "campaign",
  "ads",
  "sponsored",
  "broad",
  "exact",
  "phrase",
  "paperback",
  "hardcover",
  "ebook",
  "kindle",
  "pt",
]);

const ASIN_LIKE = /^[a-z0-9]{8,}$/;

export function isWeakSponsoredFamilyKey(key: string): boolean {
  const normalized = normalizeBookFamilyKey(key);
  if (!normalized || normalized.length < 2) return true;
  return FAMILY_STOP.has(normalized);
}

function isAsinLikeKey(key: string): boolean {
  return ASIN_LIKE.test(key.replace(/\s+/g, ""));
}

const COUNTRY_RANK: Record<string, number> = {
  US: 0,
  CA: 1,
  GB: 2,
  UK: 2,
};

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  UK: "United Kingdom",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  AU: "Australia",
  JP: "Japan",
  MX: "Mexico",
  IN: "India",
};

export function emptySponsoredMarketplaceIndex(): SponsoredMarketplaceIndex {
  return { countriesByKey: new Map(), keysByCampaignId: new Map() };
}

export function productAdsForVisibleCampaigns(
  campaigns: readonly MarketplaceCampaignRef[],
  productAds: readonly MarketplaceProductAdRef[],
): MarketplaceProductAdRef[] {
  const visibleCampaignIds = new Set(
    campaigns
      .filter((campaign) => {
        const state = String(campaign.state ?? "").trim().toLowerCase();
        return state === "enabled" || state === "paused";
      })
      .map((campaign) => String(campaign.id ?? "").trim())
      .filter(Boolean),
  );
  return productAds.filter((ad) => visibleCampaignIds.has(String(ad.campaign_id ?? "").trim()));
}

export function normalizeMarketplaceCountry(value: string | null | undefined): string | null {
  const code = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code;
}

export function sortMarketplaceCountries(codes: Iterable<string>): string[] {
  const unique = [...new Set(
    [...codes].map((code) => normalizeMarketplaceCountry(code)).filter((code): code is string => !!code),
  )];
  return unique.sort((a, b) => {
    const rankA = COUNTRY_RANK[a] ?? 50;
    const rankB = COUNTRY_RANK[b] ?? 50;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}

/** Flags only when the book is sponsored in two or more marketplaces. */
export function multiMarketplaceCountries(codes: Iterable<string>): string[] {
  const sorted = sortMarketplaceCountries(codes);
  return sorted.length >= 2 ? sorted : [];
}

function countryFlagEmoji(countryCode: string): string {
  const cc = countryCode === "UK" ? "GB" : countryCode;
  if (!/^[A-Z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc].map((ch) => 127397 + ch.charCodeAt(0)));
}

export function marketplaceFlagEmojis(codes: Iterable<string>): string[] {
  return multiMarketplaceCountries(codes).map((code) => countryFlagEmoji(code));
}

export function marketplaceFlagsA11y(codes: Iterable<string>): string | null {
  const countries = multiMarketplaceCountries(codes);
  if (!countries.length) return null;
  const names = countries.map((code) => COUNTRY_NAMES[code] ?? code);
  if (names.length === 2) return `Sponsored in ${names[0]} and ${names[1]}`;
  return `Sponsored in ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Flags for a campaign's own verified profile marketplace. */
export function identityFlagEmojis(codes: Iterable<string>): string[] {
  return sortMarketplaceCountries(codes).map((code) => countryFlagEmoji(code));
}

export function identityFlagsA11y(codes: Iterable<string>): string | null {
  const countries = sortMarketplaceCountries(codes);
  if (!countries.length) return null;
  if (countries.length === 1) return COUNTRY_NAMES[countries[0]] ?? countries[0];
  const names = countries.map((code) => COUNTRY_NAMES[code] ?? code);
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function countryCodeForProfile(
  profiles: readonly MarketplaceProfileRef[],
  amazonProfileId: string | null | undefined,
): string | null {
  return countryByProfileId(profiles).get(String(amazonProfileId ?? "").trim()) ?? null;
}

export function countriesForCampaignIdentity(
  profiles: readonly MarketplaceProfileRef[],
  campaign: MarketplaceCampaignRef,
): string[] {
  const country = countryCodeForProfile(profiles, campaign.amazon_profile_id);
  return country ? [country] : [];
}

export function normalizeBookFamilyKey(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Strip trailing marketplace + targeting labels so "NC - Auto" and "NC - ASIN - CA" share a family. */
export function campaignBookFamilyKey(name: string | null | undefined): string {
  let text = String(name ?? "").trim();
  if (!text) return "";
  let previous = "";
  while (text && text !== previous) {
    previous = text;
    text = text.replace(MARKETPLACE_SUFFIX, "").trim();
    text = text.replace(TARGETING_SUFFIX, "").trim();
  }
  const key = normalizeBookFamilyKey(text);
  if (isWeakSponsoredFamilyKey(key)) return "";
  return key;
}

export function bookFamilyKeys(book: SponsoredBookRef): string[] {
  const keys = new Set<string>();
  const titleKey = campaignBookFamilyKey(book.title) || normalizeBookFamilyKey(book.title);
  if (titleKey && !isWeakSponsoredFamilyKey(titleKey)) keys.add(titleKey);
  const bookKey = normalizeBookFamilyKey(book.book_key);
  if (bookKey && !isWeakSponsoredFamilyKey(bookKey)) keys.add(bookKey);
  // KDP logical work keys encode exact format siblings, for example
  // DIGITAL=<kindle>:PRINT=<paperback>. Product ads normally carry only the
  // advertised paperback ASIN, so index every encoded sibling explicitly.
  // This is deterministic identity data, never title/name similarity.
  for (const match of String(book.book_key ?? "").toUpperCase().matchAll(
    /(?:DIGITAL|PRINT|PAPERBACK|HARDCOVER|AUDIO|AUDIOBOOK)=([A-Z0-9]{10})/g,
  )) {
    const formatAsin = normalizeBookFamilyKey(match[1]);
    if (formatAsin && isAsinLikeKey(formatAsin)) keys.add(formatAsin);
  }
  const asin = normalizeBookFamilyKey(book.asin);
  if (asin && isAsinLikeKey(asin)) keys.add(asin);
  const sku = normalizeBookFamilyKey(book.sku);
  if (sku && isAsinLikeKey(sku)) keys.add(sku);
  return [...keys];
}

export function campaignFamilyKeys(campaign: MarketplaceCampaignRef): string[] {
  const keys = new Set<string>();
  const fromName = campaignBookFamilyKey(campaign.name);
  if (fromName) keys.add(fromName);
  for (const key of bookFamilyKeys({
    title: campaign.book_title,
    asin: campaign.book_asin,
    book_key: campaign.book_key,
  })) {
    keys.add(key);
  }
  return [...keys];
}

function addCountryForKey(
  countriesByKey: Map<string, Set<string>>,
  key: string,
  country: string | null,
) {
  if (!key || !country) return;
  let set = countriesByKey.get(key);
  if (!set) {
    set = new Set();
    countriesByKey.set(key, set);
  }
  set.add(country);
}

function countryByProfileId(profiles: readonly MarketplaceProfileRef[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of profiles) {
    const country = normalizeMarketplaceCountry(profile.country_code);
    if (!country) continue;
    const id = String(profile.id ?? "").trim();
    const adsId = String(profile.profile_id ?? "").trim();
    if (id) map.set(id, country);
    if (adsId) map.set(adsId, country);
  }
  return map;
}

export function buildSponsoredMarketplaceIndex(input: {
  profiles: readonly MarketplaceProfileRef[];
  campaigns?: readonly MarketplaceCampaignRef[];
  productAds?: readonly MarketplaceProductAdRef[];
}): SponsoredMarketplaceIndex {
  const countriesByKey = new Map<string, Set<string>>();
  const keysByCampaignId = new Map<string, Set<string>>();
  const countryOf = countryByProfileId(input.profiles);

  for (const campaign of input.campaigns ?? []) {
    const country = countryOf.get(String(campaign.amazon_profile_id ?? "").trim()) ?? null;
    if (!country) continue;
    for (const key of bookFamilyKeys({ asin: campaign.book_asin, book_key: campaign.book_key })) {
      addCountryForKey(countriesByKey, key, country);
    }
  }

  for (const ad of input.productAds ?? []) {
    const country = countryOf.get(String(ad.amazon_profile_id ?? "").trim()) ?? null;
    if (!country) continue;
    const keys = bookFamilyKeys({ asin: ad.asin, sku: ad.sku });
    for (const key of keys) addCountryForKey(countriesByKey, key, country);
    const campaignId = String(ad.campaign_id ?? "").trim();
    if (campaignId && keys.length) {
      let campaignKeys = keysByCampaignId.get(campaignId);
      if (!campaignKeys) {
        campaignKeys = new Set();
        keysByCampaignId.set(campaignId, campaignKeys);
      }
      for (const key of keys) campaignKeys.add(key);
    }
  }

  return { countriesByKey, keysByCampaignId };
}

/**
 * Build the same index from Nest's ownership-checked `/campaigns/books`
 * relationship. `campaignIds` originates from exact advertised ASIN/SKU rows;
 * campaign names and title similarity are deliberately never consulted.
 */
export function buildSponsoredMarketplaceIndexFromCampaignBooks(input: {
  profiles: readonly MarketplaceProfileRef[];
  campaigns: readonly MarketplaceCampaignRef[];
  books: readonly MarketplaceCampaignBookRef[];
}): SponsoredMarketplaceIndex {
  const countriesByKey = new Map<string, Set<string>>();
  const keysByCampaignId = new Map<string, Set<string>>();
  const countryOf = countryByProfileId(input.profiles);
  const profileByCampaignId = new Map(
    input.campaigns
      .map((campaign) => [
        String(campaign.id ?? "").trim(),
        String(campaign.amazon_profile_id ?? "").trim(),
      ] as const)
      .filter(([campaignId, profileId]) => !!campaignId && !!profileId),
  );

  for (const book of input.books) {
    const asin = normalizeBookFamilyKey(book.asin);
    if (!asin || !isAsinLikeKey(asin)) continue;
    for (const rawCampaignId of book.campaignIds ?? []) {
      const campaignId = String(rawCampaignId ?? "").trim();
      if (!campaignId) continue;
      const country = countryOf.get(profileByCampaignId.get(campaignId) ?? "") ?? null;
      if (!country) continue;
      addCountryForKey(countriesByKey, asin, country);
      let campaignKeys = keysByCampaignId.get(campaignId);
      if (!campaignKeys) {
        campaignKeys = new Set();
        keysByCampaignId.set(campaignId, campaignKeys);
      }
      campaignKeys.add(asin);
    }
  }

  return { countriesByKey, keysByCampaignId };
}

export function mergeSponsoredMarketplaceIndexes(
  ...indexes: Array<SponsoredMarketplaceIndex | null | undefined>
): SponsoredMarketplaceIndex {
  const countriesByKey = new Map<string, Set<string>>();
  const keysByCampaignId = new Map<string, Set<string>>();
  for (const index of indexes) {
    if (!index) continue;
    for (const [key, countries] of index.countriesByKey) {
      let set = countriesByKey.get(key);
      if (!set) {
        set = new Set();
        countriesByKey.set(key, set);
      }
      for (const country of countries) set.add(country);
    }
    for (const [campaignId, keys] of index.keysByCampaignId) {
      let set = keysByCampaignId.get(campaignId);
      if (!set) {
        set = new Set();
        keysByCampaignId.set(campaignId, set);
      }
      for (const key of keys) set.add(key);
    }
  }
  return { countriesByKey, keysByCampaignId };
}

function countriesForKeys(index: SponsoredMarketplaceIndex, keys: string[]): string[] {
  const found = new Set<string>();
  for (const key of keys) {
    const set = index.countriesByKey.get(key);
    if (!set) continue;
    for (const country of set) found.add(country);
  }
  return multiMarketplaceCountries(found);
}

export function countriesForSponsoredBook(
  index: SponsoredMarketplaceIndex | null | undefined,
  book: SponsoredBookRef,
): string[] {
  if (!index) return [];
  // Multi-market flags must resolve only via exact ASIN / book_key / SKU
  // identity — never title or campaign-name family keys.
  return countriesForKeys(
    index,
    bookFamilyKeys({ asin: book.asin, sku: book.sku, book_key: book.book_key }),
  );
}

export function countriesForSponsoredCampaign(
  index: SponsoredMarketplaceIndex | null | undefined,
  campaign: MarketplaceCampaignRef,
): string[] {
  if (!index) return [];
  const keys = new Set(bookFamilyKeys({ asin: campaign.book_asin, book_key: campaign.book_key }));
  const campaignId = String(campaign.id ?? "").trim();
  for (const key of index.keysByCampaignId.get(campaignId) ?? []) keys.add(key);
  return countriesForKeys(index, [...keys]);
}
