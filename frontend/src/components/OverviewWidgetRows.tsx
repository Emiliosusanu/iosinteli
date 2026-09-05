import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BookCover } from "@/src/components/BookCover";
import { SFSymbol } from "@/src/components/ios/Native";
import type { AdGroupEnriched, PlacementMixRow, TopBookRow, TopCampaignRow } from "@/src/lib/queries";
import { fallbackAsinCoverUrl } from "@/src/lib/targeting";
import { acosTone, dashboard, toneColor, type Theme } from "@/src/lib/theme";
import { formatCurrency, formatInt, formatPercent } from "@/src/lib/format";
import { resolveBookNet, bookNetIsKnown } from "@/src/lib/netRoyalties";
import type { SearchTerm } from "@/src/lib/types";
import type { SponsoredMarketplaceIndex } from "@/src/lib/bookMarketplaces";
import { BookMarketplaceFlags } from "@/src/components/MarketplaceFlags";

const ROW = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

export function WidgetRowList({ children }: { children: React.ReactNode }) {
  return <View>{children}</View>;
}

function rowBorder(t: Theme, isLast: boolean) {
  return {
    borderBottomColor: t.colors.separator,
    borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
  };
}

export function KeywordWidgetRow({
  row,
  currency,
  t,
  onPress,
  isLast,
}: {
  row: { id: string; keyword_text?: string | null; total_spend?: number; total_acos?: number; total_orders?: number; total_sales?: number };
  currency: string;
  t: Theme;
  onPress: () => void;
  isLast?: boolean;
}) {
  const spend = Number(row.total_spend) || 0;
  const acos = Number(row.total_acos) || 0;
  const hasSales = Number(row.total_sales) > 0;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      style={[ROW.row, rowBorder(t, !!isLast)]}
    >
      <View style={{ flex: 1, marginRight: t.spacing.md }}>
        <Text style={[t.typography.subhead, { color: t.colors.text_primary, fontWeight: "600" }]} numberOfLines={1}>
          {row.keyword_text || "Keyword"}
        </Text>
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]}>
          {formatCurrency(spend, currency, { compact: true })} spend
        </Text>
      </View>
      <Text
        style={[
          t.typography.metric_compact,
          {
            color: !hasSales
              ? t.colors.tone_danger
              : toneColor(acosTone(acos), t.colors),
          },
        ]}
      >
        {hasSales ? formatPercent(acos) : "—"}
      </Text>
    </TouchableOpacity>
  );
}

export function SearchTermWidgetRow({
  row,
  currency,
  t,
  onPress,
  isLast,
}: {
  row: SearchTerm;
  currency: string;
  t: Theme;
  onPress?: () => void;
  isLast?: boolean;
}) {
  const spend = Number(row.total_spend ?? row.spend) || 0;
  const acos = Number(row.total_acos ?? row.acos) || 0;
  const hasSales = Number(row.total_sales ?? row.sales) > 0;
  const label = row.search_term || "Search term";
  const body = (
    <>
      <View style={{ flex: 1, marginRight: t.spacing.md }}>
        <Text style={[t.typography.subhead, { color: t.colors.text_primary, fontWeight: "600" }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]} numberOfLines={1}>
          {formatCurrency(spend, currency, { compact: true })} · {formatInt(Number(row.total_orders ?? row.orders))} orders
        </Text>
      </View>
      <Text
        style={[
          t.typography.metric_compact,
          { color: hasSales ? toneColor(acosTone(acos), t.colors) : t.colors.tone_danger },
        ]}
      >
        {hasSales ? formatPercent(acos) : "—"}
      </Text>
    </>
  );
  if (!onPress) {
    return <View style={[ROW.row, rowBorder(t, !!isLast)]}>{body}</View>;
  }
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" style={[ROW.row, rowBorder(t, !!isLast)]}>
      {body}
    </TouchableOpacity>
  );
}

export function CampaignWidgetRow({
  campaign,
  currency,
  t,
  onPress,
  isLast,
  showPlacement,
}: {
  campaign: TopCampaignRow;
  currency: string;
  t: Theme;
  onPress: () => void;
  isLast?: boolean;
  showPlacement?: boolean;
}) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" style={[ROW.row, rowBorder(t, !!isLast)]}>
      <View style={{ flex: 1, marginRight: t.spacing.md }}>
        <Text style={[t.typography.subhead, { color: t.colors.text_primary, fontWeight: "600" }]} numberOfLines={1}>
          {campaign.name}
        </Text>
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]} numberOfLines={1}>
          {formatCurrency(campaign.spend, currency, { compact: true })} spend · {formatInt(campaign.orders)} orders
        </Text>
        {showPlacement ? <PlacementShareLine item={campaign} t={t} /> : null}
      </View>
      <Text
        style={[
          t.typography.metric_compact,
          {
            color:
              campaign.orders === 0 && campaign.spend > 0
                ? t.colors.tone_danger
                : campaign.sales > 0
                  ? toneColor(acosTone(campaign.acos), t.colors)
                  : t.colors.text_secondary,
          },
        ]}
      >
        {campaign.sales > 0 ? formatPercent(campaign.acos) : "—"}
      </Text>
    </TouchableOpacity>
  );
}

export function AdGroupWidgetRow({
  row,
  currency,
  t,
  onPress,
  isLast,
}: {
  row: AdGroupEnriched;
  currency: string;
  t: Theme;
  onPress: () => void;
  isLast?: boolean;
}) {
  const spend = Number(row.total_spend ?? row.spend) || 0;
  const acos = Number(row.total_acos ?? row.acos) || 0;
  const hasSales = Number(row.total_sales ?? row.sales) > 0;
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" style={[ROW.row, rowBorder(t, !!isLast)]}>
      <View style={{ flex: 1, marginRight: t.spacing.md }}>
        <Text style={[t.typography.subhead, { color: t.colors.text_primary, fontWeight: "600" }]} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]} numberOfLines={1}>
          {formatCurrency(spend, currency, { compact: true })} spend
        </Text>
      </View>
      <Text style={[t.typography.metric_compact, { color: hasSales ? toneColor(acosTone(acos), t.colors) : t.colors.text_secondary }]}>
        {hasSales ? formatPercent(acos) : "—"}
      </Text>
    </TouchableOpacity>
  );
}

export function BookWidgetRow({
  book,
  currency,
  t,
  blur,
  onPress,
  isLast,
  marketplaceIndex,
}: {
  book: TopBookRow;
  currency: string;
  t: Theme;
  blur?: boolean;
  onPress: () => void;
  isLast?: boolean;
  marketplaceIndex?: SponsoredMarketplaceIndex;
}) {
  const bookName = book.title || book.asin || book.sku || "Book";
  const bookKdpAvailable = book.kdp_state !== "missing" && book.royalties != null;
  const resolvedNet = resolveBookNet(book);
  const bookNetReady = bookNetIsKnown(book);
  const bookNet = bookNetReady && resolvedNet != null
    ? `${resolvedNet >= 0 ? "+" : ""}${formatCurrency(resolvedNet, currency)}`
    : bookKdpAvailable
      ? formatCurrency(book.royalties!, currency, { compact: true })
      : "—";
  const rightMetricColor =
    bookNetReady && resolvedNet != null
      ? resolvedNet >= 0
        ? t.colors.tone_good
        : t.colors.tone_danger
      : bookKdpAvailable
        ? t.colors.tone_good
        : t.colors.text_tertiary;

  return (
    <TouchableOpacity onPress={onPress} disabled={!book.asin && !book.sku} style={[ROW.row, rowBorder(t, !!isLast)]}>
      <View>
        <BookCover
          uri={book.image_url}
          fallbackUri={fallbackAsinCoverUrl(book.asin || book.sku)}
          asin={book.asin || book.sku}
          size="sm"
          recyclingKey={book.asin || book.sku || bookName}
        />
        {blur ? (
          <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: t.colors.background_secondary, opacity: 0.92, borderRadius: 7, alignItems: "center", justifyContent: "center" }}>
            <SFSymbol name="eye.slash" size={14} color={t.colors.text_tertiary} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, marginHorizontal: t.spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
          <Text style={[t.typography.subhead, { color: blur ? t.colors.text_tertiary : t.colors.text_primary, fontWeight: "600", flex: 1, minWidth: 0 }]} numberOfLines={2}>
            {blur ? "Hidden title" : bookName}
          </Text>
          {!blur && marketplaceIndex ? (
            <BookMarketplaceFlags index={marketplaceIndex} book={book} style={t.typography.subhead} />
          ) : null}
        </View>
        <Text style={[t.typography.caption2, { color: t.colors.text_secondary, marginTop: 2 }]}>
          {bookKdpAvailable ? `${formatCurrency(book.royalties!, currency, { compact: true })} royalties · ` : ""}
          {formatCurrency(book.spend, currency, { compact: true })} spend ·{" "}
          <Text style={{ color: book.sales > 0 ? toneColor(acosTone(book.acos, book.breakeven_acos), t.colors) : t.colors.text_secondary }}>
            {book.sales > 0 ? formatPercent(book.acos) : "—"} ACoS
          </Text>
        </Text>
      </View>
      <Text style={[t.typography.metric_compact, { color: rightMetricColor }]}>
        {bookNet}
      </Text>
    </TouchableOpacity>
  );
}

function PlacementShareLine({ item, t }: { item: TopCampaignRow; t: Theme }) {
  const shares = [
    { label: "Top", value: Number(item.placement_top_share ?? 0), color: t.colors.tone_warning },
    { label: "Product", value: Number(item.placement_product_share ?? 0), color: t.colors.tone_placement },
    { label: "Rest", value: Number(item.placement_rest_share ?? 0), color: t.colors.tone_good },
  ].filter((row) => row.value > 0.5);
  if (!shares.length) return null;
  return (
    <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 3 }]} numberOfLines={1}>
      {shares.map((row) => `${row.label} ${formatPercent(row.value, 0)}`).join(" · ")}
    </Text>
  );
}

export function PlacementMixV2({
  rows,
  currency,
  t,
}: {
  rows: PlacementMixRow[];
  currency: string;
  t: Theme;
}) {
  const colorFor = (placement: string) => {
    if (placement === "top_of_search") return t.colors.tone_warning;
    if (placement === "product_pages") return t.colors.tone_placement;
    if (placement === "rest_of_search") return t.colors.tone_good;
    return t.colors.text_tertiary;
  };

  return (
    <View style={{ gap: dashboard.compactGap }}>
      {rows.map((row) => {
        const color = colorFor(row.placement);
        const barWidth = `${Math.max(6, Math.min(100, row.share))}%` as `${number}%`;
        return (
          <View key={row.placement}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <Text style={[t.typography.subhead, { color: t.colors.text_primary, fontWeight: "600", flex: 1 }]} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={[t.typography.metric_compact, { color: row.sales > 0 ? toneColor(acosTone(row.acos), t.colors) : t.colors.text_tertiary }]}>
                {row.sales > 0 ? formatPercent(row.acos, 0) : "—"}
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.background_tertiary, overflow: "hidden" }}>
              <View style={{ width: barWidth, height: 6, borderRadius: 3, backgroundColor: color }} />
            </View>
            <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 4 }]}>
              {formatPercent(row.share, 0)} spend · {formatCurrency(row.spend, currency, { compact: true })}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
