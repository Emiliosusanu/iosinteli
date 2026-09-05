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
  name?: string | null;
  amazon_profile_id?: string | null;
  book_key?: string | null;
  book_asin?: string | null;
  book_title?: string | null;
};

export type MarketplaceProductAdRef = {
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

export type SponsoredMarketplaceIndex = {
  countriesByKey: Map<string, Set<string>>;
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
  return { countriesByKey: new Map() };
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
  const countryOf = countryByProfileId(input.profiles);

  for (const campaign of input.campaigns ?? []) {
    const country = countryOf.get(String(campaign.amazon_profile_id ?? "").trim()) ?? null;
    if (!country) continue;
    for (const key of campaignFamilyKeys(campaign)) {
      addCountryForKey(countriesByKey, key, country);
    }
  }

  for (const ad of input.productAds ?? []) {
    const country = countryOf.get(String(ad.amazon_profile_id ?? "").trim()) ?? null;
    if (!country) continue;
    const titleKey = campaignBookFamilyKey(ad.title) || normalizeBookFamilyKey(ad.title);
    if (titleKey && !isWeakSponsoredFamilyKey(titleKey)) addCountryForKey(countriesByKey, titleKey, country);
    const asin = normalizeBookFamilyKey(ad.asin);
    if (asin && isAsinLikeKey(asin)) addCountryForKey(countriesByKey, asin, country);
    const sku = normalizeBookFamilyKey(ad.sku);
    if (sku && isAsinLikeKey(sku)) addCountryForKey(countriesByKey, sku, country);
  }

  return { countriesByKey };
}

export function mergeSponsoredMarketplaceIndexes(
  ...indexes: Array<SponsoredMarketplaceIndex | null | undefined>
): SponsoredMarketplaceIndex {
  const countriesByKey = new Map<string, Set<string>>();
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
  }
  return { countriesByKey };
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
  return countriesForKeys(index, bookFamilyKeys(book));
}

export function countriesForSponsoredCampaign(
  index: SponsoredMarketplaceIndex | null | undefined,
  campaign: MarketplaceCampaignRef,
): string[] {
  if (!index) return [];
  return countriesForKeys(index, campaignFamilyKeys(campaign));
}
