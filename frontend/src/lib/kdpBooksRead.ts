import { primaryAsinFromGroupKey } from "./kdpBookIdentity";
import { pickCalculatorBreakEvenAcos } from "./kdpTitlePresentation";
import { netRoyaltiesKnown } from "./netRoyalties";

export type LogicalBookAccumulator = {
  asin: string;
  asins: Set<string>;
  royalties: number;
  orders: number;
  spend: number;
  sales: number;
  impressions: number;
  clicks: number;
  title: string | null;
  image_url: string | null;
  breakeven_candidates: number[];
};

export type AssembledBookRow = {
  book_key: string;
  asin: string;
  sku: string | null;
  title: string | null;
  image_url: string | null;
  impressions: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  royalties: number;
  acos: number;
  roas: number;
  net: number;
  breakeven_acos: number;
};

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function emptyLogicalBook(asin: string): LogicalBookAccumulator {
  return {
    asin,
    asins: new Set<string>(),
    royalties: 0,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    title: null,
    image_url: null,
    breakeven_candidates: [],
  };
}

/** One logical book row from a proven group_key. One malformed book cannot kill the list. */
export function assembleLogicalBookRows(groups: Map<string, LogicalBookAccumulator>): AssembledBookRow[] {
  const rows: AssembledBookRow[] = [];
  for (const [key, group] of groups) {
    try {
      if (!key || !group) continue;
      const asin = primaryAsinFromGroupKey(key, group.asins) || String(group.asin ?? "").trim().toUpperCase();
      if (!asin) continue;
      const title = typeof group.title === "string" && group.title.trim() ? group.title : null;
      const royalties = toNumber(group.royalties);
      const spend = toNumber(group.spend);
      const sales = toNumber(group.sales);
      rows.push({
        book_key: key,
        asin,
        sku: null,
        title,
        image_url: group.image_url,
        impressions: toNumber(group.impressions),
        clicks: toNumber(group.clicks),
        orders: toNumber(group.orders),
        spend,
        sales,
        royalties,
        acos: sales > 0 ? (spend / sales) * 100 : 0,
        roas: spend > 0 ? sales / spend : 0,
        net: netRoyaltiesKnown(royalties, spend),
        breakeven_acos: pickCalculatorBreakEvenAcos(group.breakeven_candidates),
      });
    } catch {
      // Skip the malformed book; keep the rest of the list.
    }
  }
  return rows;
}
