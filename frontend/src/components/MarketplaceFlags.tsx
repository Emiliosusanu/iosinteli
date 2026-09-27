import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import {
  marketplaceFlagEmojis,
  marketplaceFlagsA11y,
  identityFlagEmojis,
  identityFlagsA11y,
  type SponsoredBookRef,
  type SponsoredMarketplaceIndex,
  countriesForSponsoredBook,
  countriesForSponsoredCampaign,
  type MarketplaceCampaignRef,
  type MarketplaceProfileRef,
  countriesForCampaignIdentity,
} from "@/src/lib/bookMarketplaces";

export function MarketplaceFlags({
  countries,
  testID,
  style,
  mode = "multi",
}: {
  countries: readonly string[];
  testID?: string;
  style?: StyleProp<TextStyle>;
  mode?: "multi" | "identity";
}) {
  const flags = mode === "identity" ? identityFlagEmojis(countries) : marketplaceFlagEmojis(countries);
  const label = mode === "identity" ? identityFlagsA11y(countries) : marketplaceFlagsA11y(countries);
  if (!flags.length) return null;
  return (
    <Text testID={testID} accessibilityLabel={label ?? undefined} style={style}>
      {flags.join(" ")}
    </Text>
  );
}

export function BookMarketplaceFlags({
  index,
  book,
  testID = "book-marketplace-flags",
  style,
}: {
  index: SponsoredMarketplaceIndex;
  book: SponsoredBookRef;
  testID?: string;
  style?: StyleProp<TextStyle>;
}) {
  return <MarketplaceFlags countries={countriesForSponsoredBook(index, book)} testID={testID} style={style} />;
}

export function CampaignMarketplaceFlags({
  index,
  profiles,
  campaign,
  testID = "campaign-marketplace-flags",
  style,
}: {
  index: SponsoredMarketplaceIndex;
  profiles: readonly MarketplaceProfileRef[];
  campaign: MarketplaceCampaignRef;
  testID?: string;
  style?: StyleProp<TextStyle>;
}) {
  if (countriesForSponsoredCampaign(index, campaign).length < 2) return null;
  return (
    <MarketplaceFlags
      countries={countriesForCampaignIdentity(profiles, campaign)}
      mode="identity"
      testID={testID}
      style={style}
    />
  );
}
