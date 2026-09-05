import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import {
  marketplaceFlagEmojis,
  marketplaceFlagsA11y,
  type SponsoredBookRef,
  type SponsoredMarketplaceIndex,
  countriesForSponsoredBook,
  countriesForSponsoredCampaign,
  type MarketplaceCampaignRef,
} from "@/src/lib/bookMarketplaces";

export function MarketplaceFlags({
  countries,
  testID,
  style,
}: {
  countries: readonly string[];
  testID?: string;
  style?: StyleProp<TextStyle>;
}) {
  const flags = marketplaceFlagEmojis(countries);
  const label = marketplaceFlagsA11y(countries);
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
  campaign,
  testID = "campaign-marketplace-flags",
  style,
}: {
  index: SponsoredMarketplaceIndex;
  campaign: MarketplaceCampaignRef;
  testID?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <MarketplaceFlags
      countries={countriesForSponsoredCampaign(index, campaign)}
      testID={testID}
      style={style}
    />
  );
}
