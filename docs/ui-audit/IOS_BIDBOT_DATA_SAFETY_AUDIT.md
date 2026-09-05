# InteliAds iOS — BidBot Data + Safety Contract

Date: 2026-08-22  
Mode: DATA + SAFETY CONTRACT (not BidBot UI QA)  
Surface: `/more/bid-bot` · `frontend/app/more/bid-bot.tsx`

No live apply, revert, run, or auto-mode change was executed.

`BIDBOT DATA + SAFETY: PASS`

---

## Architecture

```text
BidBotScreen                       /more/bid-bot
├── Viewing-customer banner        all writes locked when adminFilterUserId
├── Tabs: Working | Settings | About
├── Working
│   ├── Status                     GET /bid-engine/status?filterUserId=
│   ├── Run engine                 POST /bid-engine/run  (JWT self only)
│   ├── Bid changes                GET /bid-recommendations/pending?filterUserId=
│   ├── Apply selected             PATCH /bid-recommendations/bulk  (ids + versionIds)
│   ├── Placements                 GET /bid-engine/placement-recommendations?filterUserId=
│   ├── Apply selected placements  POST /bid-engine/placement-recommendations/apply
│   └── Activity + Revert          GET /bid-engine/apply-log · POST .../apply-log/:id/revert
└── Settings
    ├── Target ACoS + auto mode    PUT /bid-engine/settings  (those two fields only)
    └── Min/max display            GET merges user_settings min_bid / max_bid (not saved here)
```

No BidBot+ route. No recommendation-detail route. History = apply log on this screen.

| Piece | Reality |
| ----- | ------- |
| Route | `/more/bid-bot` |
| Queries | status, settings, pending recs, placements, apply-log |
| Writes | run, bulk apply, placement apply, settings PUT, revert |
| Scope inputs | `user.id` · `guestMode` · `adminFilterUserId` · `primaryCurrency` |
| **Not used** | `selectedProfileIds` · Nest `bidEngineScope` editor · `autoScheduleEnabled` · cooldown UI |

---

## Modes

| INTERNAL | USER LABEL | What it does | Auto-apply? | Entities | Profile scope | Safety gates |
| -------- | ---------- | ------------ | ----------- | -------- | ------------- | ------------ |
| `off` | Off | Recommendations only | No | n/a | n/a | n/a |
| `high_confidence` | **Careful** | After a **run** (and on scheduled jobs if `autoScheduleEnabled`) auto-applies recs whose `expected_impact.confidence === 'high'` | Yes, high only | Engine scope (default keywords; may include product_target / auto if saved on web) | `bidEngineScope` (default `all`), **not** iOS selection | Watchdog, guardrails, daily cap, version claim, Amazon stale check |
| `aggressive` | Aggressive | Same, high **or medium** | Yes, high+medium | Same | Same | Same; watchdog step is slightly larger |

This is an **auto-apply mode**, not a recommendation filter. iOS does not hide medium recs when Careful is on.

`autoScheduleEnabled` defaults **false**. iOS Save does **not** write it. Unattended cron only runs when that flag is already true (usually set on web). **Run engine** with mode ≠ off still calls `autoApplyPendingForUser` immediately.

No BidBot+ model on iOS.

---

## Recommendation contract

```text
GET /bid-recommendations/pending?filterUserId=
  → optional fallback GET /bid-recommendations?status=pending
  → list as-is (no local profile filter)
  → Apply PATCH /bid-recommendations/bulk { ids, status: "applied", requestId, versionIds }
```

DTO fields that exist (`BidRecommendationResponseDto`):

| Field | On iOS type? | Shown? |
| ----- | ------------ | ------ |
| `id` | yes | selection key |
| `campaignId` / `campaignName` | yes | subtitle |
| `keywordId` / `keyword` | yes | title (or “Keyword”) |
| `currentBid` / `recommendedBid` | yes | `a → b` with `primaryCurrency` |
| `reason` | yes | server string, 3 lines |
| `currentVersionId` | yes | sent on apply |
| `engineScore` / `bidDelta` / `direction` | type only | no |
| `confidence` (0–n score) | **not on iOS type** | no |
| `expectedImpact` (includes categorical confidence, entityType) | **not on iOS type** | no |
| `metricsWindows` / `dataAsOf` / `expiresAt` | **not on iOS type** | no |
| `status` / `applicationStatus` | type only | pending list only |
| profile / marketplace / currency | **absent** | n/a |

Product targets / auto share `keywordId` + `keyword` text. Title can say “Keyword” for an ASIN target.

---

## Recommendation state machine

Backend statuses: `pending` | `applied` | `rejected` | `expired` plus `application_status`.

```text
GENERATED (pending + application_status pending)
  → AVAILABLE on Working
  → APPLYING (iOS applyingBids)
  → envelope items: applied | stale | conflict | failed | skipped | already_applied | expired
  → CONFIRMED only if summary.applied matches requested (iOS now requires this)

AVAILABLE
  → EXPIRED / version missing → apply item expired (not a local TTL)

APPLIED (apply-log revert_status=applied)
  → REVERTING
  → reverted | stale | conflict | failed | already_applied
```

iOS does not invent RECONCILING UI. Web does.

---

## Profile scope

Pending recs are **all campaigns on `user_campaigns` for the read-target user** (`generated_for_user_id`). Default engine scope is `mode: all`, `entityTypes: ['keyword']`.

`selectedProfileIds` is **not** sent and **cannot** be applied client-side (no profile id on the DTO).

Apply uses recommendation `id` + `generated_for_user_id = acting user`. A rec from another profile of the **same** user can be applied while TopBar shows a different profile. **P1** (same account, wrong view context), not cross-user.

---

## Admin view-as

| Call | Before | After |
| ---- | ------ | ----- |
| Status | `filterUserId` customer | same + keyed by user |
| Recs / settings / placements / log | **no** filter. Admin GET pending with `resolveTargetUserId` **null** = **all users** | `filterUserId = adminFilterUserId ?? user.id` |
| Run / apply / placement / settings / revert | JWT admin | **Locked** in view-as (same class as Accounts / Sync) |

Web **can** mutate a customer via `filterUserId` on writes. iOS must not invent that. Cross-user apply of a foreign rec id already fails Nest ownership; the P0 was **displaying all users / customer status while applying admin self**, and **saving admin auto-mode while viewing customer status**.

---

## Currency

No currency on the recommendation. iOS uses AppContext `primaryCurrency` (from **selected** profiles). A GBP rec shown while a USD profile is selected can be labeled `$`. **P1** — no payload field to fix locally.

---

## Current vs snapshot values

`currentBid` / `recommendedBid` are **recommendation-generation snapshots** (`current_bid` / `recommended_bid` on the row).

Apply safety uses that snapshot as `expectedStartingBid` and compares to Amazon. If Amazon moved: `STALE_BID` / `DATA_STALE` in the envelope — not a silent overwrite.

Do not label the snapshot as a live Amazon read. iOS shows `snapshot → proposed` without the word “Current.”

---

## Confidence

| Raw | Display | Meaning |
| --- | ------- | ------- |
| Placement `confidence` string (`high` / `medium` / `low`) | pill as-is | Categorical engine label, **not** a probability |
| Bid `confidence` number (`confidence_score`) | unused | Score, not a % |
| `expected_impact.confidence` | unused on iOS | What auto-mode actually gates |

`PRODUCT / BACKEND SEMANTICS GAP` if UI later says “92% confident.”

---

## Reasons

Bid `reason` is the **server string**. iOS does not reconstruct scoring. Placement has no reason field (only % → %).

---

## Apply bid mutation

```text
TAP Apply selected
→ PATCH /bid-recommendations/bulk
  { ids, status: "applied", requestId, versionIds: { [id]: currentVersionId } }
→ Nest: ownership + versionIds must equal current_version_id
→ claim/lease + Amazon write
→ envelope { requestId, items[], summary }
```

Missing `currentVersionId` → version conflict (fail closed).  
HTTP 200 with `applied: 0` is **failure** on iOS now (was false success).

No confirmation (coverage still true). Recommendation for UI pass: confirm bulk / raises.

---

## Placement mutation

```text
POST /bid-engine/placement-recommendations/apply
{ campaignIds, requestId, recommendations: [{ campaignId, recommendationId, recommendationVersion }] }
```

Values are **percent adjustments** (ToS / PP / RoS), not currency. Cooldown pill is server `inCooldown`. Version mismatch → conflict. Same envelope check as bids.

---

## Auto-mode mutation

`PUT /bid-engine/settings` body iOS now sends: `{ targetAcos, autoMode }` only.

- Per **user** (not per profile)
- Takes effect on next **run** / scheduler tick
- No confirm
- Failure: Alert, local segmented state may disagree until refetch
- View-as: locked

`minBid` / `maxBid` on GET come from `user_settings.min_bid` / `max_bid` (merged in `getSettingsForUser`). The settings DTO **does not accept** those fields. Sending them was a no-op.

---

## Revert

Confirm: “This writes the previous bid back to Amazon Ads.”

Restores apply-log `bid_before` (or placement before snapshot). Expects Amazon still at `bid_after`. Newer manual edit → stale, not overwrite. Already reverted → `already_applied`. iOS now treats failed/stale/conflict envelopes as errors.

No BidBot reapply (Rules reapply is a different route).

---

## Guardrails

| Setting | Source of truth | BidBot? | Settings screen? | Rules? |
| ------- | --------------- | ------- | ---------------- | ------ |
| `min_bid` / `max_bid` | `user_settings` (web Settings / web BidBot blur-save) | GET display only | **No** — iOS Settings writes `mobileSettings` | Yes |
| `targetAcos` / `autoMode` | `user_settings.bid_engine_settings` | Yes | No | Pauses rules when auto on (`autoBotDisablesRules`) |
| `cooldownHours` | bid_engine_settings (default 48) | Unused on iOS | iOS Settings cooldown → `mobileSettings` | Rules use `entity_cooldown_hours` |
| `dailyBidChangeCap` | bid_engine_settings | Backend auto only | No | No |
| `mobileSettings` min/max/cooldown | iOS Settings + AsyncStorage | **No** | Yes | **No** |

**PRODUCT / DATA CONTRACT P1:** two min/max UIs, one dead for the engine.

---

## Settings conflicts

`/more/settings` “Bid guardrails” persist `mobileSettings` via Supabase. BidBot Save does **not** write that blob or `min_bid`. Correct store for engine caps is web `min_bid` / `max_bid`. Not merged this pass (source of truth proven; Settings is a later workstream).

---

## Mutation risk matrix

| Mutation | Scope | Consequence | Confirm | Pending lock | Backend confirm | Reversible | Failure recovery |
| -------- | ----- | ----------- | ------- | ------------ | --------------- | ---------- | ---------------- |
| Apply bids | JWT user, selected rec ids (any of that user’s campaigns) | Live Amazon bids | **No** | `applyingBids` | Envelope `applied` | Yes, apply-log | Alert; selection kept on throw |
| Apply placements | JWT, selected campaigns | Live placement % | **No** | `applyingPlacements` | Envelope | Yes if log row | Alert |
| Run engine | JWT, engine scope | New recs; **auto-apply if mode ≠ off** | **No** | `running` | HTTP 200 of run | Applied rows revertible | Alert |
| Save auto mode | JWT user | Enables auto-apply on **next run** | **No** | `saving` | PUT settings | Save Off | Alert; refetch |
| Revert | JWT, that log id | Writes `bid_before` | Yes | `revertingId` | Envelope outcome | n/a | Alert |

---

## Recommendation truth matrix

| UI field | Source | Snapshot/live | Unit | Can stale? | Safe as “current”? |
| -------- | ------ | ------------- | ---- | ---------- | ------------------ |
| Left bid | `current_bid` | Snapshot at generation | money, labeled with selected currency | Yes | **No** |
| Right bid | `recommended_bid` | Snapshot | money | Yes | Proposed only |
| Reason | `reason` | Snapshot | text | Yes | As server text |
| Placement % | rec placements | Snapshot | percent | Yes | No |
| Placement confidence | rec.confidence | Snapshot | category | Yes | Not a probability |
| ACoS / spend / orders | not shown | — | — | — | — |

---

## Query / cache scope

Keys: `user.id` + `adminFilterUserId ?? "self"`.  
`placeholderData: undefined`, `staleTime: 0`.  
Reads always pass `filterUserId`. Writes never pass it.

---

## Errors

Fetch: empty / spinner; no dedicated error card (P2).  
Apply / revert / save / run: `alertMutationError`.  
Stale / version / guardrail: envelope message, not raw stack.  
402 plan gate via Nest helper.

---

## History

`GET /bid-engine/apply-log` page 1, 30 rows: keyword text, bid before/after, relative time, `applySource`. No revert_status on iOS type — Revert shown for every row (backend may no-op / fail).

---

## Backend boundary

```text
MOBILE CONTRACT VERIFIED     endpoints, DTO, envelopes, view-as, versionIds
BACKEND ENGINE INTERNAL      scoring, pools, watchdog math, Phase 3 preview
BACKEND CONTRACT UNKNOWN     live Amazon bid at paint time; per-marketplace currency on recs
```

---

## P0 / P1

| ID | Issue | Class | Status |
| -- | ----- | ----- | ------ |
| BB-P0-1 | View-as writes used JWT admin while status could be customer | MUTATION SCOPE BUG | **Fixed** — lock |
| BB-P0-2 | Admin GET pending without filter = **all users** | QUERY SCOPE BUG | **Fixed** — always send user id |
| BB-P1-1 | HTTP 200 apply treated as success when `applied: 0` | MUTATION SAFETY BUG | **Fixed** |
| BB-P1-2 | `selectedProfileIds` ignored | QUERY SCOPE / PRODUCT | Open — no profile on DTO |
| BB-P1-3 | Currency = selected `primaryCurrency` | FRONTEND DATA MAPPING | Open — no currency field |
| BB-P1-4 | Apply / placement / Run+auto have no confirm | MUTATION SAFETY | Documented for UI pass |
| BB-P1-5 | Settings `mobileSettings` ≠ engine `min_bid` | PRODUCT / DATA CONTRACT | Documented; BidBot Save no longer pretends to write min/max |
| BB-P1-6 | Snapshot bid looks current | UI COPY / PRODUCT | Documented |
| BB-P1-7 | Auto schedule flag not set on iOS | BACKEND/PRODUCT | Documented |

No unresolved P0. Remaining P1s cannot be fixed without inventing backend fields or starting Settings/UI redesign.

---

## Requirements for future BidBot UI QA

1. Keep view-as lock. Do not add customer writes without an explicit Nest product decision.
2. Confirm Apply / placement / enabling Aggressive / Run-while-auto.
3. Say snapshot vs Amazon; don’t invent confidence %.
4. Don’t claim selected-profile scope until the API has profile ids.
5. Don’t treat Settings min/max as BidBot until they write `min_bid` / `max_bid`.
6. Empty states: guest, view-as, no recs, fetch error — not one “No bid changes.”
7. Device QA later. No SwiftUI.

---

## Changes this pass

- View-as mutation lock + banner
- Read `filterUserId` + query keys (kills all-users admin list)
- Apply/revert envelopes must prove Amazon success
- Save only `targetAcos` + `autoMode`; Careful label
- `frontend/tests/bidbot-safety.test.js`

---

## Files changed

- `frontend/src/lib/bidBotContract.ts` (new)
- `frontend/src/lib/mutations.ts`
- `frontend/app/more/bid-bot.tsx`
- `frontend/tests/bidbot-safety.test.js` (new)
- `docs/ui-audit/IOS_BIDBOT_DATA_SAFETY_AUDIT.md` (this file)
- `docs/ui-audit/IOS_UI_PROGRESS.md`
- `docs/ui-audit/IOS_REMAINING_COVERAGE.md`
- `docs/ui-audit/IOS_SCREEN_QA_MATRIX.md`
