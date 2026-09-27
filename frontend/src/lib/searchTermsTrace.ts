/**
 * Best-effort Search Terms funnel trace (Documents/searchterms-trace.txt).
 * Always pair ENTER with OK / FAIL / ABORT so hung reads leave an exit mark.
 */
import { Platform } from "react-native";

const TRACE_FILE = "searchterms-trace.txt";

async function appendLine(line: string): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    // Expo SDK 54: classic FileSystem helpers live under /legacy.
    const FileSystem = await import("expo-file-system/legacy");
    const root = FileSystem.documentDirectory;
    if (!root) return;
    const path = `${root}${TRACE_FILE}`;
    const stamp = new Date().toISOString();
    const row = `${stamp} ${line}\n`;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      const prev = await FileSystem.readAsStringAsync(path).catch(() => "");
      // Cap growth — keep last ~80KB.
      const next = prev.length > 80_000 ? prev.slice(-60_000) + row : prev + row;
      await FileSystem.writeAsStringAsync(path, next);
    } else {
      await FileSystem.writeAsStringAsync(path, row);
    }
  } catch {
    // Trace must never affect the query path.
  }
}

export async function searchTermsTrace(event: string, detail?: string): Promise<void> {
  const suffix = detail ? ` ${detail}` : "";
  await appendLine(`${event}${suffix}`);
}

/** Wrap a campaigns prelude (or any step) so ENTER always gets an exit. */
export async function withSearchTermsHttpTrace<T>(
  label: string,
  signal: AbortSignal | undefined,
  work: () => Promise<T>,
): Promise<T> {
  await searchTermsTrace(`${label}_ENTER`);
  try {
    const result = await work();
    await searchTermsTrace(`${label}_OK`);
    return result;
  } catch (error) {
    if (signal?.aborted) {
      await searchTermsTrace(`${label}_ABORT`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      await searchTermsTrace(`${label}_FAIL`, message.slice(0, 160));
    }
    throw error;
  }
}
