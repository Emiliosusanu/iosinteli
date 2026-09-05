# PHYSICAL OVERVIEW V2 — status

Date: 2026-08-30/31
Device: iPhone 14 PRO Emiliano (`00008120-001210563E6BC01E`)

## Verdict

**PHYSICAL OVERVIEW V2: BLOCKED (host pairing)**

Crash root cause found and fixed in source + Release rebuilt. Physical install/screenshots blocked because the device is **not paired** with this Mac (`idevicepair`: accept Trust dialog).

## Crash root cause (proven)

Remote launch returned SpringBoard because InteliAds **exited ~300ms after foreground**:

1. `TypeError: undefined is not a function` in `AppProvider`
   - `AppContext` called `onQueryCacheHydrated(...)` but `queryPersist.ts` no longer exported it / `isQueryCacheHydrated` / `markQueryCacheHydrated`.
2. After restoring those, app stayed alive but auth stuck on “Checking session”:
   - `AuthContext` called `setLiveSupabaseSession(...)` but `rulesApi.ts` no longer exported it / `peekLiveSupabaseAccessToken`.

Syslog proof (first crash):
`Unhandled JS Exception: TypeError: undefined is not a function` → `AppProvider` component stack.
Later: `[auth] Session hydration failed; continuing unauthenticated`, `[TypeError: undefined is not a function]`.

## Fixes landed (phasea-read + mirrored hydrate helpers on main)

- `frontend/src/lib/queryPersist.ts`: restore hydrate waiters; `markQueryCacheHydrated()` in `finally` **before** best-effort `hydrateTargetsQueries` (phasea-read).
- `frontend/src/lib/rulesApi.ts`: restore `setLiveSupabaseSession` / `peekLiveSupabaseAccessToken` / live-token short-circuit.
- `AppDelegate.swift`: stop cold-start `QANativeHTTPProbeRunner.autoRunFromStoredSessionIfRequested()` (TurboModule abort path when QA keep-awake was used).

Release rebuilt at `/tmp/InteliAds-PhaseA-CoreRead-DerivedData/.../InteliAds.app` with markers:
`markQueryCacheHydrated`, `setLiveSupabaseSession`, `peekLiveSupabaseAccessToken` present in `main.jsbundle`.

Unit: `amazon-profile-query-policy.test.js` 5/5 PASS.

## Physical gates remaining (after Trust)

1. Install fixed Release + remint/seed session.
2. Overview V2 screenshots (hero, Campaigns widget, Books, motion).
3. Warm Campaigns / Books timings.
4. Targets online measure (no 11k Home prefetch).
5. Declare **PHYSICAL OVERVIEW V2 PASS** and STOP.

## Current blocker

```
ERROR: Device ... is not paired with this host
Please accept the trust dialog on the screen of device ...
```

USB is visible (`idevice_id` lists UDID). Lockdown/install hang until Trust is accepted.
