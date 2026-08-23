# InteliAds iOS — Sync Data / State Contract

Date: 2026-08-22  
Mode: DATA CONTRACT + STATE TRUTH (not Sync UI QA)  
Surface: `/more/sync` · `frontend/app/more/sync.tsx`

No live Sync Now / Cancel was executed on production jobs.

`SYNC DATA & STATE: PASS`

---

## Architecture

```text
SyncScreen                         /more/sync
├── Viewing-customer banner        mutations locked when adminFilterUserId
├── Sync now                       POST /amazon/sync  (JWT self only)
├── Cancel                         POST /amazon/sync/cancel  (JWT self, only if canMutate && in progress)
├── SyncStatusCard                 Ads-only hero from Nest status + profile_sync_logs
├── Completed / Failed / Records   counts over the loaded profile_sync_logs window
├── Accounts                       profile_sync_logs for selectedProfileIds
├── Recent activity                sync_logs for signed-in user_id (hidden in view-as)
└── Intraday                       ams_messages for selectedProfileIds (display only)
```

### Route / files

| Piece | Reality |
| ----- | ------- |
| Route | `/more/sync` |
| Screen | `frontend/app/more/sync.tsx` |
| Queries | `fetchSyncOverview` (`queries.ts`) · `fetchSyncStatus` (`mutations.ts`) · `fetchIntradayMessages` (in-screen Supabase) |
| Mutations | `triggerSync` · `cancelSync` |
| Contract helpers | `frontend/src/lib/syncContract.ts` |
| Nest (read-only web repo) | `POST /amazon/sync` · `POST /amazon/sync/cancel` · `GET /amazon/sync/status` · `GET /sync-logs` (unused by iOS) |
| Inputs | `user.id` · `guestMode` · `selectedProfileIds` · `adminFilterUserId` |
| Not used | AppState on this screen · KDP collect · report_queue rows · `GET /sync-logs` |

### Queries

| Query | Key | Source | Enabled | Poll |
| ----- | --- | ------ | ------- | ---- |
| `syncQ` | `sync-overview`, user, admin-or-self, selectedProfileIds | Supabase `sync_logs` (self only) + `profile_sync_logs` | signed-in + ≥1 selected profile | no |
| `statusQ` | `sync-status`, user, admin-or-self | `GET /amazon/sync/status` (+ `filterUserId` in view-as) | signed-in, not guest | 4s while `isSyncInProgress` |
| `intraQ` | `ams-intraday`, user, admin-or-self, selectedProfileIds | Supabase `ams_messages` | signed-in + ≥1 selected profile | no |

All three override global `placeholderData: keepPreviousData` and `staleTime: 60s`. Status uses `staleTime: 0` and `refetchOnMount: "always"`.

---

## Source inventory

| Source | Actually synced here? | Triggered by Sync Now? | Status available? | Freshness available? |
| ------ | --------------------: | ---------------------: | ----------------: | -------------------: |
| Amazon Ads entities (campaigns, ad groups, keywords, product ads, product targets, negatives, product metadata) | Yes, via Nest manual job | Yes, all **enabled** JWT profiles | Yes, `profile_sync_logs.status` + Nest `isSyncInProgress` | Yes, `completed_at` on those rows |
| Campaign / keyword / product-ad / product-target metrics + search terms | Yes, queued as `report_queue` during the same job | Yes (async after accept) | Parent stays `pending` while reports pending | Report completion is **not** shown as its own row |
| Hourly / intraday Ads reports | Scheduler (`sync_type=hourly`), not this button | No | Visible later as session type Hourly | Session `completed_at` if loaded |
| Nightly / full reconciliation | Scheduler (`sync_type=full`) | No | Visible later as session type Nightly | Session `completed_at` if loaded |
| AMS (`ams_messages`) | Independent stream | **No** | Rows only if the table query succeeds | Event time ≠ Ads last-success |
| KDP / royalties / books collect | **No** | **No** | **No** on this screen | **DATA/FRESHNESS GAP** |
| Background iOS task | Local spend/order/book alerts | No | Unrelated | Unrelated |

---

## Sync state machine

Backend enums (`sync-status.enum.ts`):

```text
sync_logs / profile_sync_logs:
  pending → completed
  pending → failed
  pending → partial_failed
  pending → cancelled

There is no persisted running / queued / processing / in_progress / stale.
isSyncInProgress ⇔ at least one sync_logs row for the target user with status=pending.
```

Frontend also treats leftover `running` / `processing` / `in_progress` as active if they ever appear. They are not written by Nest today.

```text
IDLE (no pending parent)
  ↓ Sync Now (JWT self, plan access, not already pending)
REQUEST ACCEPTED  (HTTP 200 + syncLogId)   ← not completion
  ↓ background executeQueuedManualUserSync
PENDING (parent + each queued profile)
  ↓ all child PSLs completed
COMPLETED
  ↓ some child failed / partial, none pending
PARTIAL_FAILED
  ↓ all child failed
FAILED

PENDING
  ↓ Cancel (JWT self)
CANCELLED parent; pending PSL → cancelled; open report_queue → failed “Cancelled by user”
  already-terminal PSL / written rows stay

PENDING
  ↓ 409 if Sync Now again
STAY PENDING (no second parent)

View-as
  → mutations stay IDLE for the admin JWT
  → status read may show customer's PENDING
```

Undefined / impossible on this client:

- Passing profile ids on Sync Now (backend ignores body; none sent)
- Cancelling a specific `syncLogId` (cancel is all pending parents for JWT user)
- Admin starting **customer** sync from iOS (POST has no `filterUserId`)
- A combined Ads+AMS+KDP parent state

---

## Sync Now contract

```text
USER TAP
→ onSyncNow
→ blocked if guest / view-as / inProgress / syncBusy / hasSyncAccess===false
→ POST /amazon/sync   no body, no profile ids, no filterUserId
→ Nest: plan gate 402 · already pending 409
→ collectProfilesForManualSync(JWT userId) where user_amazon_profiles.is_enabled=true
  and a refresh token exists and the profile is not already pending
→ insert sync_logs { sync_type: 'manual', status: pending }
→ insert profile_sync_logs + sync_log_profiles
→ HTTP 200 { message, syncLogId, profileCount, timestamp }
→ executeQueuedManualUserSync continues in process
→ iOS refetches GET /amazon/sync/status
→ 4s poll until isSyncInProgress is false
→ then refetch overview + invalidateAds()
```

| Field | Reality |
| ----- | ------- |
| Account / profile scope | **All enabled Amazon profiles for the JWT user**, not `selectedProfileIds` |
| Admin scope | JWT admin self. View-as cannot fire this. |
| Request id | `syncLogId` returned; iOS does not persist it |
| 200 meaning | **Job accepted / at least one profile queued** — not job complete |
| Cache | Status refetch immediately; ads/overview invalidate when pending falls |
| Duplicate tap | Button disabled while `syncBusy` or `inProgress`; Nest 409 |

---

## Cancel contract

```text
USER TAP (only while canMutate && isSyncInProgress)
→ POST /amazon/sync/cancel   no body, no job id
→ cancelSync(JWT userId)
→ all pending sync_logs for that user → cancelled
→ linked pending profile_sync_logs → cancelled
→ linked open report_queue → failed, last_error “Cancelled by user”
→ already completed / failed PSL and already-written Ads rows remain
→ HTTP 200 { message: 'Sync cancelled' } even if nothing was pending (no-op)
```

| Question | Answer |
| -------- | ------ |
| Which job? | Every **pending** parent for the JWT user |
| Job id required? | No |
| One profile or all? | All pending profiles linked to those parents |
| View-as? | Locked. Cancel would have hit the **admin** JWT |
| Already complete? | No-op |
| Cancel fails? | 503 surfaced via `alertMutationError` |
| Retry after cancel? | Yes, once no pending parent remains |
| Confirmation today | None. UI pass may add one — Cancel is more consequential than Sync Now |

---

## Profile scope

Sync Now does **not** read iOS `selectedProfileIds`.

Nest selects `user_amazon_profiles` for the JWT user with `is_enabled = true`.

iOS selection only decides:

- whether the screen shows the empty “No account connected” state
- which `profile_sync_logs` / `ams_messages` rows are listed

Deselecting a profile in the TopBar does **not** stop backend sync.

---

## Admin view-as

| Action | Before this audit | After |
| ------ | ----------------- | ----- |
| Sync Now | Fired JWT **admin** sync while listing customer profiles | Locked (`canMutateSync` false) |
| Cancel | Would cancel **admin** pending jobs | Locked / hidden |
| Status | Admin’s `isSyncInProgress` (no `filterUserId`) | `GET /status?filterUserId=` customer |
| Sessions | Admin `sync_logs.user_id` shown as Recent activity | Not fetched in view-as |
| Profile logs | Customer `selectedProfileIds` | Unchanged (read) |
| Web Sync page | Hides Sync/Cancel for **all** admins; logs use `filterUserId` | iOS admin-self can still sync own Ads |

P0 (admin syncs self while viewing customer) is closed on iOS. Do not invent `filterUserId` on POST sync.

---

## Session semantics

`sync_logs` (user-level parent):

| Field | Meaning |
| ----- | ------- |
| `id` | Parent job id (`syncLogId`) |
| `user_id` | Owner of the job |
| `sync_type` | `manual` · `hourly` · `full` |
| `status` | pending / completed / failed / partial_failed / cancelled |
| `started_at` | Queue time |
| `completed_at` | Set when parent becomes terminal |
| `records_synced` | Sum of child entity **synced** counts |
| `records_failed` | Sum of child entity **failed** counts |
| `error_message` | Present on type; not always populated on parent |
| `created_at` | Insert time |

One session is one parent job (manual tap, hourly tick, or nightly full) covering one or more profiles via `sync_log_profiles`.

---

## Log semantics

`profile_sync_logs` (Accounts list):

One row is **one profile’s participation in one parent job**, not “the account forever,” not one report type, not one hour of metrics.

Counts on the row are entity upsert counts from that run (`campaigns_*`, `ad_groups_*`, `keywords_*`, `product_ads_*`, `product_targets_*`). Search-term / metric report rows live on `report_queue` and are not listed here.

---

## Ads vs AMS

AMS = Amazon Marketing Stream messages in `ams_messages`.

Manual Sync Now does **not** subscribe or refresh AMS (`AmsSubscriptionService` is unused in the manual path).

If Ads completes and AMS is empty or stale, hero can still be “Amazon Ads up to date.” There is **no** combined Ads+AMS parent status. Do not invent Partial for AMS miss.

Intraday is display-only and hidden when the table query fails.

---

## Ads vs KDP boundary

Verified in iOS source: `/more/sync` does not open KDP, scrape royalties, use a KDP WebView, or call a collect endpoint.

Chrome / helper remains the collector. Accounts only link/unlink KDP.

**ADS SYNC FRESHNESS** = Ads `profile_sync_logs.completed_at` / Nest pending flag.  
**KDP IMPORT FRESHNESS** = not available on this screen → `DATA/FRESHNESS GAP`.

Overview can still deep-link “KDP royalties only through …” to `/more/sync`. That is a leftover product-semantics issue on a PASS screen — Sync cannot refresh royalties.

---

## Freshness

Suitable for “Ads updated”:

- `profile_sync_logs.completed_at` of a completed Ads profile row

Not suitable:

- `started_at`
- HTTP 200 timestamp
- AMS `event_time`
- KDP royalty date (not loaded here)
- Job-start fallback (removed from the hero)

Missing `completed_at` on a completed row → “Amazon Ads sync finished”, not “up to date.”

---

## Partial failure

A manual job has several profiles and several report types.

Parent rollup (`updateSyncLogStatus` / reaggregate):

| Evidence | Parent |
| -------- | ------ |
| Any child still pending | `pending` |
| All completed | `completed` |
| All failed | `failed` |
| All cancelled | `cancelled` |
| Mix of terminal success/fail/cancel | `partial_failed` |

Hero uses the **loaded profile window** (up to 80 rows): any `failed` / `partial_failed` → “Amazon Ads needs review.” Latest completed alone is not enough.

```text
FULL SUCCESS     latest completed + completed_at + no fail/partial in window + not pending
PARTIAL SUCCESS  any fail/partial in window  → needs review
FULL FAILURE     latest failed (and/or only failures)
UNKNOWN          no rows / load error / missing completed_at
```

AMS and KDP are **not** part of this rollup.

---

## Polling

- 4s while `statusQ.data.isSyncInProgress`
- Stops when false
- Enabled only when signed-in and not guest
- Depends on `adminFilterUserId` in the query key and request
- No AppState hook; JS timers pause in background and resume
- Errors: React Query retry 1 (global); no invented idle on failure
- After pending → not pending: overview refetch + `invalidateAds()`

---

## Cache / query scope

| Risk | Mitigation |
| ---- | ---------- |
| Admin A logs under customer B | Status + overview + AMS keys include `adminFilterUserId` |
| `keepPreviousData` flashes prior customer | `placeholderData: undefined` on these queries |
| 60s stale status misses another-device job | status `staleTime: 0`, `refetchOnMount: "always"` |
| View-as sessions = admin jobs | `includeSessions: false` when viewing a customer |

`GET /sync-logs?filterUserId=` exists on Nest and is unused. Customer session history remains a **backend/API gap** on iOS.

---

## App lifecycle

Sync is **server-side**.

| Event | Truth |
| ----- | ----- |
| Background then return | Remount refetches status; poll resumes if still pending |
| Kill and reopen | Pending/completed recovered from Nest + Supabase |
| Another device / web starts sync | Visible once status refetch sees a pending parent for that user |
| Navigate away | Job continues. No “leaving cancels sync” warning (that warning would be false) |

Local-only sync state does **not** exist.

---

## Notifications relationship

`notifications.ts` schedules **local** alerts for new orders, overspend, and book ACoS. Deep link `/(tabs)`. Not sync-complete / sync-fail. Not remote sync push.

Do not describe background fetch as “keeps Ads + KDP fresh.”

---

## Mutation matrix

| Action | Scope | Backend request | Pending | Confirmation | Final proof | Failure |
| ------ | ----- | --------------- | ------- | ------------ | ----------- | ------- |
| Sync now | JWT user, all **enabled** profiles | `POST /amazon/sync` | `syncBusy`; button off | None | `isSyncInProgress` then parent/PSL terminal | 402 plan · 409 already running · 400 no enabled profiles · Alert |
| Cancel | JWT user, all **pending** parents | `POST /amazon/sync/cancel` | `cancelBusy` | None | Status not in progress; PSL cancelled | 503 / Alert |
| Pull / header refresh | Current query scope | none | RefreshControl | n/a | Refetch settles | Stale data remains |
| View-as tap | none | none | n/a | Alert | n/a | n/a |

---

## Copy truth audit

| Copy | Class |
| ---- | ----- |
| Sync now | ACCURATE (starts Ads job for enabled JWT profiles) |
| Cancel / Canceling… | ACCURATE (pending JWT jobs) |
| Syncing Amazon Ads… | ACCURATE |
| Amazon Ads up to date | ACCURATE **if** latest PSL completed + `completed_at` + no fail/partial in window. Still a single-hero rollup (per-profile may differ). |
| Amazon Ads needs review | ACCURATE for fail/partial in window |
| Amazon Ads not synced yet | ACCURATE when no usable completed row |
| Amazon Ads sync finished | ACCURATE when completed without `completed_at` |
| Ads updated `<completed_at>` | ACCURATE |
| Started `<started_at>` | ACCURATE for in-progress only |
| Sign in to sync | ACCURATE |
| Viewing a customer… | ACCURATE |
| No account connected | AMBIGUOUS — means no **selected** profile, not “Amazon disconnected” |
| Completed / Failed stats | AMBIGUOUS — counts **rows in the loaded window**, not distinct current profiles |
| Records | AMBIGUOUS / DATA SEMANTICS — sum of entity synced counts across loaded PSL rows (not catalog size, not last job only, omits search terms / metrics) |
| Intraday | AMBIGUOUS — AMS messages, not hourly Ads freshness |
| Customer sessions not loaded here | ACCURATE |
| All data up to date | FALSE (removed) |
| Sync complete on HTTP 200 | FALSE (never claimed; still must not be added) |
| Sync Now updates KDP | FALSE (never claimed on this screen) |

---

## P0

| ID | Issue | Class | Status |
| -- | ----- | ----- | ------ |
| SYN-P0-1 | Admin view-as Sync Now / Cancel acted on JWT admin while listing customer Ads logs | MUTATION SCOPE BUG | **Fixed** — mutations locked; status read uses `filterUserId`; sessions omitted |

No unresolved P0.

---

## P1

| ID | Issue | Class | Status |
| -- | ----- | ----- | ------ |
| SYN-P1-1 | “All data up to date” implied KDP/AMS/all sources | UI COPY BUG | **Fixed** — Ads-only labels |
| SYN-P1-2 | Hero “Updated” used `started_at` as last success | FRONTEND STATE BUG | **Fixed** |
| SYN-P1-3 | Query keys omitted `adminFilterUserId`; status ignored view-as | QUERY SCOPE BUG | **Fixed** |
| SYN-P1-4 | Admin sessions listed as customer Recent activity | QUERY SCOPE BUG | **Fixed** (hidden; Nest list unused) |
| SYN-P1-5 | Pending/running shown as failed xmark | FRONTEND STATE BUG | **Fixed** |
| SYN-P1-6 | One green hero hides per-profile staleness | PRODUCT SEMANTICS GAP | Open — needs UI, not invented combined state |
| SYN-P1-7 | Overview KDP-stale row routes to `/more/sync` | PRODUCT SEMANTICS GAP | Open — Overview is a PASS screen; do not reopen here |
| SYN-P1-8 | Expired Amazon token has no reconnect CTA (generic fail / retry) | PRODUCT SEMANTICS GAP | Open — reconnect stays on Accounts |
| SYN-P1-9 | Customer session history not available on iOS | BACKEND/API GAP | Open — use `GET /sync-logs?filterUserId=` later |

---

## P2 / P3

- Records stat is a window sum; product targets counted in Records but not in the row caption
- Loading spinner replaces Sync Now (does not say “Syncing”)
- 402 text remapped to `PLAN_MANAGE_MESSAGE`
- Cancel has no confirm
- Raw AMS `message_type`
- Empty state “No account connected” vs deselected
- Recovered-from-fail still “needs review” while older fail rows remain in the 80-row window
- Web hides Sync for every admin; iOS allows admin-self

---

## Frontend state bugs

Fixed: start-time-as-freshness; running-as-failed icon; acceptance-not-wired-as-complete (already true, tests lock it).

Open: per-profile vs global hero (P1-6).

---

## Query / mutation scope bugs

Fixed: view-as writes; status/query keys; admin sessions under customer.

Open: iOS still filters PSL by `selectedProfileIds` (view), while Sync Now uses Nest `is_enabled` (expected once documented).

---

## Backend / API gaps

- POST sync/cancel have no `filterUserId` (do not invent)
- `isSyncInProgress` is pending-parent only
- No Ads+AMS+KDP aggregate
- No KDP freshness on this API for iOS
- `GET /sync-logs` admin filter unused by iOS
- Error strings may be internal Amazon/LWA text; iOS shows `error_message` as-is (2 lines)

---

## Product semantics gaps

- Selected ≠ enabled
- Hourly/nightly appear in Recent activity but are not user-triggered
- Overview KDP attention → Sync
- “Records” has no user-facing definition

---

## Requirements for Sync UI QA

1. Keep Ads vs KDP vs AMS wording. Never restore “All data up to date.”
2. Keep view-as lock. Do not add customer Sync Now without a Nest contract.
3. Decide whether to show per-profile freshness instead of one hero.
4. Label Records or drop the stat.
5. Optional Cancel confirm.
6. Optional `GET /sync-logs?filterUserId=` for view-as sessions.
7. Loading chrome must stay distinct from “Syncing Amazon Ads.”
8. Pull-to-refresh must stay refetch-only.
9. Device QA: standard / small / large, light / dark, Dynamic Type — **not this pass**.
10. Do not migrate to SwiftUI.

---

## Changes made this pass

- View-as mutation lock + banner
- Status `filterUserId` + scoped query keys + no previous-customer placeholder
- Ads-only hero / pills / types; freshness uses `completed_at`
- Running ≠ failed; cancelled ≠ failed
- Hide admin sessions while viewing a customer
- Plan-gate disables Sync now
- `frontend/tests/sync-data.test.js`

---

## Files changed

- `frontend/src/lib/syncContract.ts` (new)
- `frontend/src/lib/mutations.ts`
- `frontend/src/lib/queries.ts`
- `frontend/app/more/sync.tsx`
- `frontend/tests/sync-data.test.js` (new)
- `docs/ui-audit/IOS_SYNC_DATA_AUDIT.md` (this file)
- `docs/ui-audit/IOS_UI_PROGRESS.md`
- `docs/ui-audit/IOS_REMAINING_COVERAGE.md`
- `docs/ui-audit/IOS_SCREEN_QA_MATRIX.md`
