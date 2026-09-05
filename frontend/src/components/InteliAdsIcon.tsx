import React from "react";
import { View } from "react-native";
import Svg, { Path, type PathProps } from "react-native-svg";
import { dashboard } from "@/src/lib/theme";

export type InteliAdsIconName =
  | "overview"
  | "campaigns"
  | "targeting"
  | "keywords"
  | "productTargets"
  | "searchTerms"
  | "books"
  | "royalties"
  | "adSpend"
  | "adsSales"
  | "adsOrders"
  | "acos"
  | "breakEvenAcos"
  | "netRoyalties"
  | "bidBot"
  | "rules"
  | "manualChanges"
  | "automation"
  | "sync"
  | "amazonAccounts"
  | "notifications"
  | "attention"
  | "success"
  | "warning"
  | "error"
  | "filter"
  | "sort"
  | "dateRange";

export type InteliAdsIconState = "default" | "selected" | "disabled" | "warning" | "positive" | "negative";

const PATHS: Record<InteliAdsIconName, string[]> = {
  overview: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"],
  campaigns: ["M5 5h10l-2.5 4L15 13H5zM5 5v15"],
  targeting: ["M7 4H4v3M17 4h3v3M4 17v3h3M20 17v3h-3M12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"],
  keywords: ["M4 7h16M4 12h11M4 17h8"],
  productTargets: ["M7 4H4v3M17 4h3v3M4 17v3h3M20 17v3h-3M9 8h6v8H9z"],
  searchTerms: ["M5 7h14M5 12h10M5 17h7"],
  books: ["M6 5h5v14H6zM13 5h5v14h-5z"],
  royalties: ["M6 5h5v14H6zM13 9h6M13 13h4"],
  adSpend: ["M4 16h4v4H4zM10 11h4v9h-4zM16 6h4v14h-4zM5 5l14 0"],
  adsSales: ["M4 17h16M8 17V9l4-3 4 3v8"],
  adsOrders: ["M7 5h10v14H7zM10 9h4M10 13h4"],
  acos: ["M5 16h4v4H5zM11 10h4v10h-4z"],
  breakEvenAcos: ["M4 12h16M12 7v10"],
  netRoyalties: ["M5 8h8M5 16h14M5 8v8"],
  bidBot: ["M4 12h16M12 8v8M8 10h2M14 14h2"],
  rules: ["M6 4v7h6M12 11l5-5M12 11l5 5"],
  manualChanges: ["M6 8h12M6 16h12M8 8v3M16 13v3"],
  automation: ["M5 7h4v4H5zM15 7h4v4h-4zM10 15h4v4h-4zM9 9h6M12 11v4"],
  sync: ["M7 8h10l-3-3M17 16H7l3 3"],
  amazonAccounts: ["M5 10h14v9H5zM8 10V8a4 4 0 0 1 8 0v2"],
  notifications: ["M6 16h12l-1-7a5 5 0 0 0-10 0zM10 18h4"],
  attention: ["M12 5l8 14H4zM12 10v4"],
  success: ["M5 13l4 4 10-10"],
  warning: ["M12 5l8 14H4zM12 10v4M12 16.5v.5"],
  error: ["M6 6l12 12M18 6L6 18"],
  filter: ["M4 6h16l-6 7v5l-4-2v-3z"],
  sort: ["M8 5v14M5 8l3-3 3 3M16 19V5M13 16l3 3 3-3"],
  dateRange: ["M6 5h12v14H6zM8 3v4M16 3v4M6 10h12"],
};

export const INTELIADS_ICON_NAMES = Object.keys(PATHS) as InteliAdsIconName[];

function strokeFor(state: InteliAdsIconState, selected: boolean): number {
  if (selected || state === "selected") return 2;
  return dashboard.iconStroke;
}

export function InteliAdsIcon({
  name,
  size = 22,
  color,
  state = "default",
  selected = false,
  decorative = true,
  accessibilityLabel,
}: {
  name: InteliAdsIconName;
  size?: number;
  color: string;
  state?: InteliAdsIconState;
  selected?: boolean;
  decorative?: boolean;
  accessibilityLabel?: string;
}) {
  const paths = PATHS[name];
  const stroke = strokeFor(state, selected);
  const common: PathProps = {
    stroke: color,
    strokeWidth: stroke,
    fill: "none",
    strokeLinecap: "butt",
    strokeLinejoin: "miter",
    opacity: state === "disabled" ? 0.4 : 1,
  };
  return (
    <View
      style={{ width: size, height: size }}
      pointerEvents="none"
      accessible={!decorative}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? "no" : "yes"}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {paths.map((d) => (
          <Path key={d} d={d} {...common} />
        ))}
      </Svg>
    </View>
  );
}
