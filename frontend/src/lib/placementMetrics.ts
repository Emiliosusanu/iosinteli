/** Per-placement traffic metrics for Targets / campaign placement rows. */

export type PlacementSlotField = "top_of_search" | "product_pages" | "rest_of_search";

export type PlacementSlotMetricValues = {
  spend: number;
  impressions: number;
  clicks: number;
  orders: number;
  sales: number;
  acos: number | null;
};

export type CampaignPlacementShares = {
  placement_top_share: number | null;
  placement_product_share: number | null;
  placement_rest_share: number | null;
  placement_top_spend: number;
  placement_top_impressions: number;
  placement_top_clicks: number;
  placement_top_orders: number;
  placement_top_sales: number;
  placement_product_spend: number;
  placement_product_impressions: number;
  placement_product_clicks: number;
  placement_product_orders: number;
  placement_product_sales: number;
  placement_rest_spend: number;
  placement_rest_impressions: number;
  placement_rest_clicks: number;
  placement_rest_orders: number;
  placement_rest_sales: number;
};

type PlacementBucket = {
  spend: number;
  impressions: number;
  clicks: number;
  orders: number;
  sales: number;
};

function emptyBucket(): PlacementBucket {
  return { spend: 0, impressions: 0, clicks: 0, orders: 0, sales: 0 };
}

function slotPrefix(field: PlacementSlotField): "placement_top" | "placement_product" | "placement_rest" {
  if (field === "top_of_search") return "placement_top";
  if (field === "product_pages") return "placement_product";
  return "placement_rest";
}

function metricsFromBucket(bucket: PlacementBucket | null | undefined): PlacementSlotMetricValues {
  // Missing placement rows → zeros/nulls — never fall back to campaign totals.
  const spend = Number(bucket?.spend) || 0;
  const impressions = Number(bucket?.impressions) || 0;
  const clicks = Number(bucket?.clicks) || 0;
  const orders = Number(bucket?.orders) || 0;
  const sales = Number(bucket?.sales) || 0;
  return {
    spend,
    impressions,
    clicks,
    orders,
    sales,
    acos: sales > 0 ? (spend / sales) * 100 : null,
  };
}

/** Empty placement mix: shares unset (unknown), slot metrics zeroed. */
export function emptyCampaignPlacementShares(): CampaignPlacementShares {
  return {
    placement_top_share: null,
    placement_product_share: null,
    placement_rest_share: null,
    placement_top_spend: 0,
    placement_top_impressions: 0,
    placement_top_clicks: 0,
    placement_top_orders: 0,
    placement_top_sales: 0,
    placement_product_spend: 0,
    placement_product_impressions: 0,
    placement_product_clicks: 0,
    placement_product_orders: 0,
    placement_product_sales: 0,
    placement_rest_spend: 0,
    placement_rest_impressions: 0,
    placement_rest_clicks: 0,
    placement_rest_orders: 0,
    placement_rest_sales: 0,
  };
}

/**
 * Metrics for one Amazon placement slot on a campaign row.
 * Missing / unloaded slot → zeros and null ACoS (not campaign totals).
 */
export function placementSlotMetrics(
  row: Partial<CampaignPlacementShares> | null | undefined,
  field: PlacementSlotField,
): PlacementSlotMetricValues {
  const prefix = slotPrefix(field);
  return metricsFromBucket({
    spend: Number((row as any)?.[`${prefix}_spend`]) || 0,
    impressions: Number((row as any)?.[`${prefix}_impressions`]) || 0,
    clicks: Number((row as any)?.[`${prefix}_clicks`]) || 0,
    orders: Number((row as any)?.[`${prefix}_orders`]) || 0,
    sales: Number((row as any)?.[`${prefix}_sales`]) || 0,
  });
}

/** Build share + per-slot metric fields from aggregated placement buckets. */
export function campaignPlacementSharesFromBuckets(
  placements: Record<string, PlacementBucket>,
  safeDivide: (a: number, b: number) => number,
): CampaignPlacementShares {
  const values = Object.values(placements);
  const totalSpend = values.reduce((sum, row) => sum + row.spend, 0);
  const totalImpressions = values.reduce((sum, row) => sum + row.impressions, 0);
  const shareFor = (placement: string): number | null => {
    const row = placements[placement];
    // Missing bucket ≠ measured 0% — only compute share when Amazon stored that placement.
    if (!row) return null;
    return totalSpend > 0
      ? safeDivide(row.spend, totalSpend) * 100
      : safeDivide(row.impressions, totalImpressions) * 100;
  };
  const top = placements.top_of_search ?? emptyBucket();
  const product = placements.product_pages ?? emptyBucket();
  const rest = placements.rest_of_search ?? emptyBucket();
  // Missing buckets stay zero for metrics; shares stay null when Amazon omitted the placement.
  return {
    placement_top_share: shareFor("top_of_search"),
    placement_product_share: shareFor("product_pages"),
    placement_rest_share: shareFor("rest_of_search"),
    placement_top_spend: top.spend,
    placement_top_impressions: top.impressions,
    placement_top_clicks: top.clicks,
    placement_top_orders: top.orders,
    placement_top_sales: top.sales,
    placement_product_spend: product.spend,
    placement_product_impressions: product.impressions,
    placement_product_clicks: product.clicks,
    placement_product_orders: product.orders,
    placement_product_sales: product.sales,
    placement_rest_spend: rest.spend,
    placement_rest_impressions: rest.impressions,
    placement_rest_clicks: rest.clicks,
    placement_rest_orders: rest.orders,
    placement_rest_sales: rest.sales,
  };
}
