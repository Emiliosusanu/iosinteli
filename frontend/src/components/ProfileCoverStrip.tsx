import React, { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { BookCover } from "@/src/components/BookCover";
import { amazonAdsProfileId } from "@/src/lib/accountScope";
import {
  fetchAmazonProfileBooks,
  type AmazonProfileBookPreview,
} from "@/src/lib/mutations";
import type { AmazonProfile } from "@/src/lib/types";

const COVER_LIMIT = 4;
/** Cap parallel Nest book fetches across all visible rows. */
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waitQueue: Array<() => void> = [];

async function withCoverConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
    const next = waitQueue.shift();
    if (next) next();
  }
}

/**
 * First 3–4 real sponsored/KDP covers for a profile. No placeholders when empty.
 */
export function ProfileCoverStrip({
  profile,
  filterUserId,
  enabled = true,
  testID,
}: {
  profile: Pick<AmazonProfile, "id" | "profile_id">;
  filterUserId?: string | null;
  enabled?: boolean;
  testID?: string;
}) {
  const [covers, setCovers] = useState<AmazonProfileBookPreview[]>([]);
  const adsId = amazonAdsProfileId(profile);

  useEffect(() => {
    if (!enabled || !adsId) {
      setCovers([]);
      return;
    }
    let cancelled = false;
    void withCoverConcurrency(async () => {
      try {
        const books = await fetchAmazonProfileBooks(adsId, { filterUserId });
        if (cancelled) return;
        setCovers(books.slice(0, COVER_LIMIT));
      } catch {
        if (!cancelled) setCovers([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adsId, enabled, filterUserId]);

  if (!covers.length) return null;

  return (
    <View testID={testID} style={styles.row} accessibilityElementsHidden>
      {covers.map((book) => (
        <BookCover
          key={book.asin}
          uri={book.coverUrl}
          asin={book.asin}
          size="xs"
          recyclingKey={`${adsId}-${book.asin}`}
          style={styles.cover}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  cover: {
    marginRight: 0,
  },
});
