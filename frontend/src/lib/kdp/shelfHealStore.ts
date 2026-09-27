/**
 * Durable + short TTL cache for `user_settings.kdp_asin_quarantine`.
 * Supabase user_settings is source of truth; AsyncStorage is offline fallback.
 */
import { storage } from "@/src/utils/storage";
import {
  KDP_ASIN_QUARANTINE_FIELD,
  makeQuarantineDoc,
  parseQuarantineDoc,
  quarantineEntriesEqual,
  type QuarantineDoc,
  type QuarantineEntry,
} from "./shelfHeal.ts";

const LOCAL_KEY_PREFIX = "inteliads.kdpAsinQuarantine.v1:";
const MEMORY_TTL_MS = 45_000;

type MemorySlot = { userId: string; doc: QuarantineDoc; loadedAt: number };

let memory: MemorySlot | null = null;

function localKey(userId: string): string {
  return `${LOCAL_KEY_PREFIX}${userId}`;
}

function emptyDoc(nowIso = new Date().toISOString()): QuarantineDoc {
  return makeQuarantineDoc([], nowIso);
}

export function clearKdpAsinQuarantineMemoryCache(): void {
  memory = null;
}

export async function loadKdpAsinQuarantine(userId: string): Promise<QuarantineDoc> {
  const uid = String(userId || "").trim();
  if (!uid) return emptyDoc();

  if (memory && memory.userId === uid && Date.now() - memory.loadedAt < MEMORY_TTL_MS) {
    return memory.doc;
  }

  try {
    const { supabase } = await import("../supabase.ts");
    const { data, error } = await supabase
      .from("user_settings")
      .select("value")
      .eq("user_id", uid)
      .eq("field_name", KDP_ASIN_QUARANTINE_FIELD)
      .maybeSingle();
    if (!error && data?.value != null) {
      const parsed = parseQuarantineDoc(data.value);
      if (parsed) {
        memory = { userId: uid, doc: parsed, loadedAt: Date.now() };
        void persistLocal(uid, parsed);
        return parsed;
      }
    }
  } catch {
    /* fall through to local */
  }

  try {
    const raw = await storage.getItem(localKey(uid), "");
    if (raw) {
      const parsed = parseQuarantineDoc(typeof raw === "string" ? JSON.parse(raw) : raw);
      if (parsed) {
        memory = { userId: uid, doc: parsed, loadedAt: Date.now() };
        return parsed;
      }
    }
  } catch {
    /* empty */
  }

  const empty = emptyDoc();
  memory = { userId: uid, doc: empty, loadedAt: Date.now() };
  return empty;
}

export async function loadKdpAsinQuarantineEntries(userId: string): Promise<QuarantineEntry[]> {
  const doc = await loadKdpAsinQuarantine(userId);
  return doc.entries;
}

/**
 * Persist quarantine when entries changed. Returns whether a remote write ran.
 * Idempotent: skips saveUserSetting when entry set is unchanged.
 */
export async function saveKdpAsinQuarantine(
  userId: string,
  entries: readonly QuarantineEntry[],
  opts?: { force?: boolean; nowIso?: string },
): Promise<{ saved: boolean; skipped: boolean; doc: QuarantineDoc }> {
  const uid = String(userId || "").trim();
  const nowIso = opts?.nowIso || new Date().toISOString();
  const next = makeQuarantineDoc(entries, nowIso);
  if (!uid) return { saved: false, skipped: true, doc: next };

  const prev = await loadKdpAsinQuarantine(uid);
  if (!opts?.force && quarantineEntriesEqual(prev.entries, next.entries)) {
    memory = { userId: uid, doc: prev, loadedAt: Date.now() };
    return { saved: false, skipped: true, doc: prev };
  }

  memory = { userId: uid, doc: next, loadedAt: Date.now() };
  await persistLocal(uid, next);

  try {
    const { saveUserSetting } = await import("../queries.ts");
    const ok = await saveUserSetting(uid, KDP_ASIN_QUARANTINE_FIELD, next);
    return { saved: ok, skipped: false, doc: next };
  } catch {
    return { saved: false, skipped: false, doc: next };
  }
}

async function persistLocal(userId: string, doc: QuarantineDoc): Promise<void> {
  try {
    await storage.setItem(localKey(userId), JSON.stringify(doc));
  } catch {
    /* best-effort */
  }
}

/** Resolve auth user id for read-path quarantine filters (best-effort). */
export async function resolveQuarantineUserId(): Promise<string | null> {
  try {
    const { supabase } = await import("../supabase.ts");
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id) return data.session.user.id;
  } catch {
    /* fall through */
  }
  try {
    const { resolveHelperUserId } = await import("../rulesApi");
    const fromNest = await resolveHelperUserId();
    if (fromNest) return fromNest;
  } catch {
    /* fall through */
  }
  return null;
}
