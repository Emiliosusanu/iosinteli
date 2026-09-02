const SESSION = "52cd43";
const INGEST = "/ingest/5223ac07-f658-4318-90c0-d45f36b43c47";
const HOSTS = ["127.0.0.1", "192.168.1.133"];

/** Debug-session ingest. Dual-hosts so simulator + physical device can both post. */
export function debugIngest(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
  runId = "post-fix",
): void {
  // Release builds must not phone home to the debug ingest hosts.
  if (typeof __DEV__ !== "undefined" && !__DEV__) return;
  const payload = {
    sessionId: SESSION,
    runId,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  const body = JSON.stringify(payload);
  for (const host of HOSTS) {
    fetch(`http://${host}:7607${INGEST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": SESSION },
      body,
    }).catch(() => {});
  }
  console.info(`[dbg52cd43] ${message}`, data);
}
