import {
  normalizeBiddingStrategyCode,
  type BiddingStrategyCode,
} from "./campaigns.ts";

/** Amazon placement bid adjustment range (percent). */
export const PLACEMENT_PERCENT_MIN = 0;
export const PLACEMENT_PERCENT_MAX = 900;

export type CampaignPlacementPercents = {
  topOfSearch: number;
  productPages: number;
  restOfSearch: number;
};

/**
 * Nest creates the campaign and ad group paused, then enables both when this
 * is true. Keep new campaigns paused until the user explicitly opts in.
 */
export const DEFAULT_ENABLE_AFTER_CREATE = false;

export const DEFAULT_AD_GROUP_CREATE_STATE = "paused" as const;

export function parsePlacementPercent(raw: string): number | null {
  const parsed = Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  if (parsed < PLACEMENT_PERCENT_MIN || parsed > PLACEMENT_PERCENT_MAX) return null;
  return parsed;
}

export function placementPercentsFromText(input: {
  topOfSearch: string;
  productPages: string;
  restOfSearch: string;
}): CampaignPlacementPercents | null {
  const topOfSearch = parsePlacementPercent(input.topOfSearch);
  const productPages = parsePlacementPercent(input.productPages);
  const restOfSearch = parsePlacementPercent(input.restOfSearch);
  if (topOfSearch == null || productPages == null || restOfSearch == null) return null;
  return { topOfSearch, productPages, restOfSearch };
}

function placementPercent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < PLACEMENT_PERCENT_MIN || value > PLACEMENT_PERCENT_MAX) {
    throw new Error(`${label} must be between 0 and 900.`);
  }
  return value;
}

type CampaignKeywordRow = {
  keyword: string;
  matchType: string;
  bid: number;
  source?: string;
};

type CampaignProductRow = {
  asin: string;
  bid: number;
  matchType?: string;
  source?: string;
};

/**
 * Body for POST /campaigns/creation.
 * biddingStrategy and placements are required Nest fields. Do not add keys
 * the DTO does not whitelist — the API rejects unknown properties.
 * enableAfterCreate enables the campaign and the ad group together.
 */
export function buildCampaignCreationBody<
  K extends CampaignKeywordRow,
  P extends CampaignProductRow,
>(input: {
  profileId: string;
  advertisedAsin: string;
  targeting: "auto" | "keywords" | "products";
  name: string;
  adGroupName: string;
  dailyBudget: number;
  defaultBid: number;
  biddingStrategy: string;
  placements: CampaignPlacementPercents;
  enableAfterCreate?: boolean;
  requestId: string;
  keywords?: K[];
  productTargets?: P[];
}): {
  profileId: string;
  advertisedAsin: string;
  targeting: "auto" | "keywords" | "products";
  name: string;
  adGroupName: string;
  dailyBudget: number;
  defaultBid: number;
  biddingStrategy: BiddingStrategyCode;
  placements: CampaignPlacementPercents;
  enableAfterCreate: boolean;
  requestId: string;
  keywords?: K[];
  productTargets?: P[];
} {
  const biddingStrategy = normalizeBiddingStrategyCode(input.biddingStrategy);
  if (!biddingStrategy) {
    throw new Error("Choose a bidding strategy.");
  }
  const body = {
    profileId: input.profileId,
    advertisedAsin: input.advertisedAsin,
    targeting: input.targeting,
    name: input.name,
    adGroupName: input.adGroupName,
    dailyBudget: input.dailyBudget,
    defaultBid: input.defaultBid,
    biddingStrategy,
    placements: {
      topOfSearch: placementPercent(input.placements.topOfSearch, "Top of search"),
      productPages: placementPercent(input.placements.productPages, "Product pages"),
      restOfSearch: placementPercent(input.placements.restOfSearch, "Rest of search"),
    },
    enableAfterCreate: input.enableAfterCreate ?? DEFAULT_ENABLE_AFTER_CREATE,
    requestId: input.requestId,
  };
  return {
    ...body,
    ...(input.keywords ? { keywords: input.keywords } : {}),
    ...(input.productTargets ? { productTargets: input.productTargets } : {}),
  };
}

/**
 * Body for POST /ad-groups. State defaults to paused until activation is explicit.
 * Placement and bidding strategy belong on the campaign, not this request.
 */
export function buildAdGroupCreationBody<T extends {
  campaignId: string;
  name: string;
  defaultBid: number;
  targeting: "auto" | "keywords" | "products";
  state?: "enabled" | "paused";
}>(input: T): Omit<T, "state"> & { state: "enabled" | "paused" } {
  const { state, ...rest } = input;
  return {
    ...rest,
    state: state ?? DEFAULT_AD_GROUP_CREATE_STATE,
  };
}
