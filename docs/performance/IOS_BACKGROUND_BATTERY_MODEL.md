# iOS background and battery model

This is the product contract for InteliAds on iPhone. Correctness does not depend on terminated-app JavaScript.

## Authority

Business alerts are **server-authoritative**:

- new Ads orders
- daily report (today, yesterday, month-to-date vs last month **same elapsed days**)
- overspend / campaign leak / book attention / ACoS movement, when those types exist on the server

iOS may show a **local Settings test** only. That test does not prove APNs.

ACoS movement, when shown, uses **percentage points** (documented threshold: 5 points). It must not be labeled “+5%” if the meaning is +5 pp.

## Push

- Visible pushes come from APNs after the server evaluates durable, idempotent events.
- Daily report dedupe is period-keyed on the server (`daily_ads_summary` + user + local date).
- A future `ads_data_updated` (or equivalent) freshness signal may invalidate Home only. It must not carry a full analytics payload.
- QA canary only until notification production gates pass. Do not enable notifications globally from this workstream.

## Background refresh

Expo background tasks stay **opportunistic cache refresh** for the compact Home snapshot.

They must not:

- detect overspend, new orders, ACoS, Rules, or BidBot outcomes
- run hourly local timers
- poll every 30s/60s
- compare the full account on every wake

If iOS does not wake the app, the next launch still shows the last verified cached snapshot, then revalidates.

## Polling

Forbidden for business detection:

- `setInterval` alert sweeps
- continuous background JS
- full-tab hydration on wake

Allowed:

- React Query `staleTime` / foreground refetch
- pull-to-refresh
- network reconnect / AppState `active` query invalidation for the Home snapshot only

## AppState

Foreground resume may refetch the compact Home snapshot. It must not start a local Ads evaluator.

## Cache persistence

Last **verified** `GET /dashboard/mobile` snapshot is persisted, namespaced by:

- user
- view-as / self
- profile scope
- currency
- schema version

Sign-out clears it. Old schema versions are dropped. Offline keeps the last verified screen and must not pretend Ads mutations succeeded.

## Server sync

Amazon Ads sync and evaluators continue on the server while the app is closed. Product correctness must not require the iPhone to be running.

## Request budget

| Path | Cold Home |
| --- | --- |
| Old seller Overview | 7 immediate React Query hooks (metrics, previous metrics, royalties, previous royalties, top books, sync logs, bleeders), then ~8 deferred hooks. Many of those expand to multiple Supabase round-trips. |
| New intended path | 1 compact `GET /dashboard/mobile`, then idle-prefetch current-scope Campaigns / Targets / Books only. |

Until the server snapshot is live and the remaining Overview widgets are retired, the client still deferred-loads the old widgets after the snapshot attempt. That is a transition, not the final budget.

## Closed app

The server keeps updating. The device may or may not execute background code. Home must remain readable from cache on the next launch.
