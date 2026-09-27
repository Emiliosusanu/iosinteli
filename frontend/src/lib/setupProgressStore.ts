/**
 * Local + remote persistence for setup dismissals only.
 * Parse/merge live in setupState.ts so unit tests stay free of RN aliases.
 */

import {
  mergeSetupProgress,
  parseSetupProgressMemory,
  setupProgressMemoryField,
  type SetupProgressMemory,
  type SetupStepId,
} from "./setupState.ts";

export { mergeSetupProgress, parseSetupProgressMemory };

const LOCAL_KEY = "inteliads.setupProgress.v1";

export async function loadLocalSetupProgress(): Promise<SetupProgressMemory | null> {
  try {
    const { storage } = await import("../utils/storage");
    const raw = await storage.getItem(LOCAL_KEY, "");
    if (!raw) return null;
    return parseSetupProgressMemory(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function rememberOptionalSetupDismissal(
  userId: string | null,
  stepId: SetupStepId,
  now = new Date(),
): Promise<{ local: true; remote: boolean }> {
  const current = await loadLocalSetupProgress();
  const next: SetupProgressMemory = {
    updatedAt: now.toISOString(),
    dismissed: { ...(current?.dismissed ?? {}), [stepId]: now.toISOString() },
  };
  try {
    const { storage } = await import("../utils/storage");
    await storage.setItem(LOCAL_KEY, JSON.stringify(next));
  } catch {
    return { local: true, remote: false };
  }
  if (!userId) return { local: true, remote: false };
  try {
    const { saveUserSetting } = await import("./queries.ts");
    const remote = await saveUserSetting(userId, setupProgressMemoryField(), next);
    return { local: true, remote };
  } catch {
    return { local: true, remote: false };
  }
}
