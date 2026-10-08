import Constants from "expo-constants";
import { Platform } from "react-native";

import { nestApiFetch } from "../rulesApi";
import { storage } from "@/src/utils/storage";
import type { KdpActivityEntry } from "./activity.ts";
import { loadHelperAccountId } from "./persist.ts";
import {
  classifyKdpDiagnosticEvent,
  levelForKdpDiagnostic,
  redactKdpDiagnosticText,
} from "./remoteDiagnosticsContract.ts";

const QUEUE_KEY = "inteliads.kdpHelper.remoteDiagnosticsQueue";
const INSTALL_ID_KEY = "inteliads.kdpHelper.diagnosticsInstallId";
const MAX_QUEUED_ENTRIES = 200;
const BATCH_SIZE = 25;

type RemoteDiagnosticEntry = {
  accountId: string;
  clientId: string;
  at: string;
  level: "error" | "info";
  event: string;
  msg: string;
  detail: {
    source: "ios_kdp_helper";
    platform: "ios";
    appVersion: string;
    buildNumber: string;
    osVersion: string;
    activityKind: KdpActivityEntry["kind"];
    installId: string;
  };
};

let queueWriteChain: Promise<void> = Promise.resolve();
let flushPromise: Promise<void> | null = null;

function appVersion(): string {
  return String(Constants.expoConfig?.version || Constants.nativeAppVersion || "unknown");
}

function buildNumber(): string {
  return String(
    Constants.expoConfig?.ios?.buildNumber || Constants.nativeBuildVersion || "unknown",
  );
}

function clientVersion(): string {
  return `ios-${appVersion()}+${buildNumber()}`.slice(0, 32);
}

async function loadQueue(): Promise<RemoteDiagnosticEntry[]> {
  try {
    const raw = await storage.getItem<string>(QUEUE_KEY, "");
    if (!raw || typeof raw !== "string") return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is RemoteDiagnosticEntry => (
        !!row && typeof row === "object" && typeof row.clientId === "string"
      ))
      .slice(-MAX_QUEUED_ENTRIES);
  } catch {
    return [];
  }
}

async function saveQueue(queue: RemoteDiagnosticEntry[]): Promise<void> {
  await storage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED_ENTRIES)));
}

async function getInstallId(): Promise<string> {
  const existing = await storage.getItem<string>(INSTALL_ID_KEY, "");
  if (existing && typeof existing === "string") return existing;
  const created = `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await storage.setItem(INSTALL_ID_KEY, created);
  return created;
}

export async function enqueueKdpRemoteDiagnostic(entry: KdpActivityEntry): Promise<void> {
  // Bind the account at capture time. A later account switch must never relabel
  // queued diagnostics from the previous KDP identity.
  const accountId = await loadHelperAccountId();
  if (!accountId) return;
  const installId = await getInstallId();
  const remoteEntry: RemoteDiagnosticEntry = {
    accountId,
    clientId: entry.id.slice(0, 80),
    at: new Date(entry.atMs).toISOString(),
    level: levelForKdpDiagnostic(entry.kind),
    event: classifyKdpDiagnosticEvent(entry.message, entry.kind),
    msg: redactKdpDiagnosticText(entry.message),
    detail: {
      source: "ios_kdp_helper",
      platform: "ios",
      appVersion: appVersion(),
      buildNumber: buildNumber(),
      osVersion: String(Platform.Version),
      activityKind: entry.kind,
      installId,
    },
  };

  queueWriteChain = queueWriteChain
    .catch(() => undefined)
    .then(async () => {
      const queue = await loadQueue();
      if (!queue.some((queued) => queued.clientId === remoteEntry.clientId)) {
        queue.push(remoteEntry);
      }
      await saveQueue(queue);
    });
  await queueWriteChain;
  void flushKdpRemoteDiagnostics();
}

export function flushKdpRemoteDiagnostics(): Promise<void> {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    await queueWriteChain.catch(() => undefined);
    for (;;) {
      const queue = await loadQueue();
      if (!queue.length) return;
      const accountId = queue[0]?.accountId;
      if (!accountId) return;
      const batch = queue
        .filter((entry) => entry.accountId === accountId)
        .slice(0, BATCH_SIZE);
      const response = await nestApiFetch("/extension-logs/batch", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          extensionVersion: clientVersion(),
          entries: batch,
        }),
      });
      if (!response.ok) return;
      const sent = new Set(batch.map((entry) => entry.clientId));
      queueWriteChain = queueWriteChain
        .catch(() => undefined)
        .then(async () => {
          const latest = await loadQueue();
          await saveQueue(latest.filter((entry) => !sent.has(entry.clientId)));
        });
      await queueWriteChain;
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      flushPromise = null;
    });
  return flushPromise;
}
