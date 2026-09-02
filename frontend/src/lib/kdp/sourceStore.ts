/** Persistence for the KDP royalty-source setting. Kept apart from the pure
 *  contract in `./source` so that module stays dependency-free for tests. */
import { storage } from "@/src/utils/storage";
import {
  DEFAULT_KDP_ROYALTY_SOURCE,
  KDP_ROYALTY_SOURCE_KEY,
  normalizeKdpRoyaltySource,
  type KdpRoyaltySource,
} from "./source.ts";

export async function getKdpRoyaltySource(): Promise<KdpRoyaltySource> {
  try {
    const raw = await storage.getItem<string>(
      KDP_ROYALTY_SOURCE_KEY,
      DEFAULT_KDP_ROYALTY_SOURCE,
    );
    return normalizeKdpRoyaltySource(raw);
  } catch {
    return DEFAULT_KDP_ROYALTY_SOURCE;
  }
}

export async function setKdpRoyaltySource(source: KdpRoyaltySource): Promise<void> {
  try {
    await storage.setItem(KDP_ROYALTY_SOURCE_KEY, normalizeKdpRoyaltySource(source));
  } catch {
    // best-effort; in-memory context state still reflects the choice
  }
}
