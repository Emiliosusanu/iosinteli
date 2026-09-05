import type { SFSymbol } from "expo-symbols";
import type { Palette } from "@/src/lib/theme";

export type MoreTone = keyof Pick<
  Palette,
  "tone_primary" | "tone_product" | "tone_warning" | "tone_good" | "tone_inactive"
>;

export type MoreHref =
  | "/more/bid-bot"
  | "/more/automation"
  | "/more/rule-history"
  | "/more/search-terms"
  | "/more/ad-groups"
  | "/more/negative-targeting"
  | "/more/sync"
  | "/more/accounts"
  | "/more/data-map"
  | "/more/settings"
  | "/more/account";

export type MoreItem = {
  key: string;
  label: string;
  subtitle: string;
  href: MoreHref;
  symbol: SFSymbol;
  color: MoreTone;
};

export type MoreGroup = {
  title: string;
  items: MoreItem[];
};

/** Navigation hub only. No live Amazon mutations and no destination queries. */
export const MORE_GROUPS: MoreGroup[] = [
  {
    title: "Automation",
    items: [
      {
        key: "bid-bot",
        label: "Bid bot",
        subtitle: "Recommendations and automation",
        href: "/more/bid-bot",
        symbol: "slider.horizontal.3",
        color: "tone_primary",
      },
      {
        key: "automation",
        label: "Rules",
        subtitle: "Automated bid and state changes",
        href: "/more/automation",
        symbol: "arrow.triangle.branch",
        color: "tone_primary",
      },
      {
        key: "rule-history",
        label: "Rule activity",
        subtitle: "History of rule runs",
        href: "/more/rule-history",
        symbol: "clock",
        color: "tone_inactive",
      },
      {
        key: "search-terms",
        label: "Search terms",
        subtitle: "Review terms from ads",
        href: "/more/search-terms",
        symbol: "magnifyingglass",
        color: "tone_primary",
      },
      {
        key: "ad-groups",
        label: "Ad groups",
        subtitle: "Browse campaign ad groups",
        href: "/more/ad-groups",
        symbol: "square.stack.3d.up",
        color: "tone_primary",
      },
      {
        key: "negative-targeting",
        label: "Negative targeting",
        subtitle: "Keywords and product targets",
        href: "/more/negative-targeting",
        symbol: "minus.circle.fill",
        color: "tone_warning",
      },
    ],
  },
  {
    title: "Data",
    items: [
      {
        key: "sync",
        label: "Sync",
        subtitle: "Amazon Ads sync",
        href: "/more/sync",
        symbol: "arrow.triangle.2.circlepath",
        color: "tone_good",
      },
      {
        key: "accounts",
        label: "Amazon accounts",
        subtitle: "Profiles, connection, and KDP links",
        href: "/more/accounts",
        symbol: "building.2",
        color: "tone_primary",
      },
      {
        key: "data-map",
        label: "Data coverage",
        subtitle: "Amazon Ads and KDP availability",
        href: "/more/data-map",
        symbol: "chart.bar",
        color: "tone_primary",
      },
    ],
  },
  {
    title: "App",
    items: [
      {
        key: "settings",
        label: "Settings",
        subtitle: "Alerts and app preferences",
        href: "/more/settings",
        symbol: "gearshape.fill",
        color: "tone_inactive",
      },
      {
        key: "account",
        label: "My account",
        subtitle: "InteliAds account and session",
        href: "/more/account",
        symbol: "person.crop.circle.fill",
        color: "tone_primary",
      },
    ],
  },
];

export function moreRowAccessibilityLabel(label: string, subtitle?: string) {
  return subtitle ? `${label}. ${subtitle}` : label;
}

export function moreAccountBannerCaption(params: {
  guestMode: boolean;
  viewingCustomer: boolean;
}) {
  if (params.viewingCustomer) return "InteliAds account · Viewing a customer";
  if (params.guestMode) return "InteliAds account · Demo";
  return "InteliAds account";
}

export function moreAccountBannerAccessibilityLabel(params: {
  email: string;
  caption: string;
}) {
  return `${params.email}. ${params.caption}`;
}
