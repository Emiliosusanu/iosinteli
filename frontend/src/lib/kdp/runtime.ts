/**
 * In-app KDP helper runtime.
 *
 * The WebView is the authenticated fetch proxy (same role as the extension
 * page hook). React Native owns schedule, parse, and Supabase writes.
 */
import type { PageFetchResult } from "./replay.ts";
import {
  hasRequiredTemplates,
  mergeCapturedTemplate,
  type KdpCapturedTemplate,
  type KdpTemplateType,
} from "./templates.ts";
import {
  applySessionToHeaders,
  loadKdpWebSession,
  mergeSessionFromCaptureHeaders,
  mergeSessionMeta,
} from "./session.ts";

type FetchWaiter = {
  resolve: (value: PageFetchResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type KdpHelperStatus = {
  ready: boolean;
  loggedIn: boolean;
  currentUrl: string;
  templates: Partial<Record<KdpTemplateType, KdpCapturedTemplate>>;
  lastError: string | null;
  lastMessage: string | null;
  running: boolean;
};

type StatusListener = (status: KdpHelperStatus) => void;

const FETCH_TIMEOUT_MS = 45_000;

let injectFn: ((js: string) => void) | null = null;
const injectStack: Array<(js: string) => void> = [];
let waiters = new Map<string, FetchWaiter>();
let reqSeq = 0;
const listeners = new Set<StatusListener>();

let status: KdpHelperStatus = {
  ready: false,
  loggedIn: false,
  currentUrl: "",
  templates: {},
  lastError: null,
  lastMessage: null,
  running: false,
};

export function getKdpHelperStatus(): KdpHelperStatus {
  return status;
}

export function subscribeKdpHelperStatus(fn: StatusListener): () => void {
  listeners.add(fn);
  fn(status);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(status);
    } catch {
      /* ignore */
    }
  }
}

export function setKdpHelperRunning(running: boolean, message?: string | null) {
  status = {
    ...status,
    running,
    lastMessage: message === undefined ? status.lastMessage : message,
  };
  emit();
}

export function setKdpHelperError(error: string | null) {
  status = { ...status, lastError: error };
  emit();
}

export function attachKdpWebView(inject: ((js: string) => void) | null) {
  if (inject) injectStack.push(inject);
  else injectStack.pop();
  injectFn = injectStack[injectStack.length - 1] ?? null;
  if (!injectFn) {
    status = { ...status, ready: false };
    emit();
  }
}

export function navigateKdpWebView(url: string) {
  if (!injectFn) return;
  const safe = JSON.stringify(url);
  injectFn(`window.location.href = ${safe}; true;`);
}

function inferLoggedIn(url: string): boolean {
  const u = String(url || "").toLowerCase();
  if (!u) return status.loggedIn;
  if (u.includes("/ap/signin") || u.includes("signin.amazon") || u.includes("/ap/mfa")) {
    return false;
  }
  return u.includes("kdpreports.amazon.com") || u.includes("kdp.amazon.com");
}

export function handleKdpWebViewMessage(raw: string) {
  let data: {
    channel?: string;
    kind?: string;
    payload?: Record<string, unknown>;
    url?: string;
  };
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (data?.channel && data.channel !== "kdp") return;

  if (data.kind === "READY") {
    status = { ...status, ready: true };
    emit();
    return;
  }

  if (data.kind === "NAV" && typeof data.url === "string") {
    status = {
      ...status,
      currentUrl: data.url,
      loggedIn: inferLoggedIn(data.url),
    };
    emit();
    return;
  }

  if (data.kind === "SESSION_META") {
    const p = data.payload || {};
    void mergeSessionMeta({
      userAgent: p.userAgent ? String(p.userAgent) : undefined,
      languages: p.languages ? String(p.languages) : undefined,
    });
    return;
  }

  if (data.kind === "CAPTURED_ITEM") {
    const p = data.payload || {};
    const url = String(p.url || "");
    const requestHeaders =
      p.requestHeaders && typeof p.requestHeaders === "object"
        ? (p.requestHeaders as Record<string, string>)
        : undefined;
    void mergeSessionFromCaptureHeaders(requestHeaders);
    status = {
      ...status,
      templates: mergeCapturedTemplate(status.templates, {
        url,
        method: p.method ? String(p.method) : undefined,
        requestHeaders,
        requestBody: p.requestBody == null ? null : String(p.requestBody),
      }),
    };
    emit();
    return;
  }

  if (data.kind === "PAGE_FETCH_RESULT") {
    const p = (data.payload || {}) as {
      reqId?: string;
      ok?: boolean;
      status?: number;
      text?: string;
      contentType?: string;
      finalUrl?: string;
      redirected?: boolean;
    };
    const id = String(p.reqId || "");
    const waiter = waiters.get(id);
    if (!waiter) return;
    waiters.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve({
      ok: Boolean(p.ok),
      status: Number(p.status || 0),
      text: String(p.text || ""),
      contentType: p.contentType,
      finalUrl: p.finalUrl,
      redirected: p.redirected,
    });
  }
}

export async function kdpPageFetch(req: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}): Promise<PageFetchResult> {
  if (!injectFn) return Promise.reject(new Error("KDP helper WebView is not attached"));
  const session = await loadKdpWebSession();
  const headers = applySessionToHeaders(req.headers, session);
  const reqId = `kdp-${Date.now()}-${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(reqId);
      reject(new Error("KDP page fetch timed out"));
    }, FETCH_TIMEOUT_MS);
    waiters.set(reqId, { resolve, reject, timer });
    const payload = JSON.stringify({
      reqId,
      url: req.url,
      method: req.method,
      headers,
      body: req.body,
    });
    injectFn!(
      `try { window.__inteliadsKdpFetch(${payload}); } catch (e) {} true;`,
    );
  });
}

export function kdpTemplatesReady(): boolean {
  return hasRequiredTemplates(status.templates);
}

export function hydrateKdpTemplates(
  templates: Partial<Record<KdpTemplateType, KdpCapturedTemplate>>,
) {
  status = { ...status, templates: { ...templates, ...status.templates } };
  emit();
}

export function resetKdpRuntime() {
  for (const w of waiters.values()) {
    clearTimeout(w.timer);
    w.reject(new Error("KDP helper reset"));
  }
  waiters = new Map();
  status = {
    ready: status.ready,
    loggedIn: false,
    currentUrl: "",
    templates: {},
    lastError: null,
    lastMessage: null,
    running: false,
  };
  emit();
}
