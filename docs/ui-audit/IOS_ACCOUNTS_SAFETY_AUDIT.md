# InteliAds iOS — Accounts State + Mutation Contract (Safety)

Date: 2026-08-22  
Mode: SAFETY AUDIT (not UI QA)  
Surfaces: `/more/accounts` · TopBar profile sheet · AppContext selection · admin `filterUserId`

No Amazon / KDP / disconnect actions were executed on live data.

`ACCOUNTS SAFETY: PASS`

---

## Architecture

Two surfaces share one account contract.

| Surface | Route / host | Job |
| ------- | ------------ | --- |
| Amazon Accounts | `/more/accounts` | Connect Amazon, **enable/disable** a profile on Nest, nickname, KDP link/unlink |
| Profile sheet | `TopBar` (not a route) | **View** which profiles are in `selectedProfileIds`; admin customer picker |
| Overview chip | pushes `/more/accounts` | Does **not** open the sheet |
| AppContext | `selectedProfileIds` + `adminFilterUserId` | Persisted query scope for every list |

### Profile list source

| Viewer | Query | `AmazonProfile.id` | `profile_id` |
| ------ | ----- | ------------------ | ------------ |
| Seller with Supabase links | `fetchAmazonProfiles` → `amazon_profiles` | row `id` (may differ from Ads id) | Amazon Ads id |
| Seller fallback / admin | `fetchNestAmazonProfiles` | **mapped to Ads `profileId`** | same |

`GET /amazon/profiles` accepts `filterUserId` (admin only). AppContext sends it when `isAdminViewer`.

### ID contract (VERIFIED)

Web toggle/nickname uses `record.profileId` (Amazon Ads id). Nest `toggleProfileEnabled` matches `user_amazon_profiles.amazon_profile_id === profileId`.

iOS **must** send Ads `profile_id` on Nest writes. Local selection may still store `p.id`.

Helpers: `frontend/src/lib/accountScope.ts` (`amazonAdsProfileId`, `amazonAdsProfileIdsForSelection`).

### Auth / credentials

- Nest JWT in SecureStore: `inteliads.rulesApi.accessToken` / `refreshToken`. Not logged.
- Guest: `canMutate` false.
- Connect: `GET /auth/amazon/connect` → system browser. Binds to the **signed-in Nest user**, not the viewed customer.
- Disconnect: Nest `DELETE /amazon/accounts/:accountId` exists on **web**. **Not on iOS.** Do not implement in this audit.

---

## Mutation inventory

| Action | UI trigger | Helper | Endpoint | Resource | Confirm | Pending | Success | Failure | Rollback | Cache | Auth / scope |
| ------ | ---------- | ------ | -------- | -------- | ------- | ------- | ------- | ------- | -------- | ----- | ------------ |
| Connect Amazon | Connect button | `fetchAmazonConnectUrl` + `WebBrowser` | `GET /auth/amazon/connect` | Signed-in user's LWA | No | `connectBusy` | Browser opens | Alert | n/a | App foreground invalidates profiles | Blocked guest + **view-as** |
| Enable profile | Switch on | `toggleAmazonProfile` | `PATCH /amazon/profiles/:id/toggle` `{ isEnabled }` | Pivot `is_enabled`; may start sync/AMS on server | No | mutation pending on that Ads id | Invalidate `amazon-profiles` | Alert | Selection restored | Query invalidate | JWT **self** only; iOS sends Ads `profile_id`; blocked view-as |
| Disable profile | Switch off | same | same | Disables pivot; server reconciles rules + AMS | **Yes** — “Turn off this account?” | same | same | Alert | Selection restored | same | same. Copy: does **not** disconnect Amazon |
| Nickname | Tap name | `updateProfileNickname` | `PATCH /amazon/profiles/:id/nickname` | Display name | Prompt Save/Cancel | `nicknameSaving` | Invalidate profiles | Alert | Modal stays | Query invalidate | Ads `profile_id`; blocked view-as |
| Link selected → KDP | Secondary button | `setKdpLinkedProfiles` | `POST /kdp/accounts/:id/profiles` | **Replace-set** of joins | Yes — names replace count | none (async IIFE) | Invalidate kdp + profiles | Alert | none (server unchanged) | Query invalidate | JWT self; Ads ids; blocked view-as |
| Unlink KDP | Unlink | `unlinkKdpProfile` | `DELETE /kdp/accounts/:id/profiles/:amazon_profile_id` | One join | Yes — names label | none | same | Alert | none | same | Linked id from server; blocked view-as |
| TopBar select | Sheet switch | `toggleProfile` | **none** | `selectedProfileIds` only | No | n/a | Immediate | n/a | n/a | Persist AsyncStorage | Currency-compatible only |
| TopBar select all | Select all | `selectAllProfiles` | none | Same currency set | No | n/a | Immediate | n/a | n/a | Persist | Local |
| Admin view-as | ACCOUNT rows | `setAdminFilterUserId` | none | `filterUserId` + **clears** selection | No | n/a | Refetch profiles | 401/403 clears filter | n/a | Invalidate profiles | Admin Nest `/auth/users` |
| Sign out | My Account (not this screen) | `signOut` | Nest logout + Supabase | Session + SecureStore tokens | Yes | — | Login | — | — | — | Clears admin filter |

**Not present on iOS:** disconnect Amazon, delete InteliAds account, delete KDP account, Chrome collect.

---

## Risk matrix

| Action | Risk | Confirmation | Pending | Backend confirm | Failure recovery | Scope clear |
| ------ | ---- | ------------ | ------- | --------------- | ---------------- | ----------- |
| Connect Amazon | HIGH | No (browser is the consent) | Yes | OAuth callback on server | Alert; no local claim | **Yes after lock** — signed-in user only; disabled in view-as |
| Enable profile | HIGH | No | Yes | Nest 200 + invalidate | Selection rollback | Ads `profile_id`; JWT self |
| Disable profile | HIGH | Yes | Yes | Nest 200 + invalidate | Selection rollback | Named in confirm; not disconnect |
| Nickname | LOW | Save/Cancel | Yes | Nest 200 | Alert; draft kept | InteliAds-only copy |
| KDP link selected | HIGH | Yes (replace-set) | No spinner | Nest 200 | Alert; links unchanged | Count + KDP name; Ads ids |
| KDP unlink | HIGH | Yes destructive | No spinner | Nest 200 | Alert | Named profile |
| TopBar view toggle | MEDIUM | No | n/a | none | n/a | View only — **different job** |
| Admin view-as | HIGH (wrong data) | No | n/a | none | 401/403 clears | Email list; auto-picks first customer |
| Disconnect | HIGH | — | — | — | — | **MISSING MOBILE** (web has it) |

---

## Scope safety

### Which InteliAds user

- Seller mutations: Nest JWT `userId`.
- `PATCH .../toggle` and `.../nickname` **do not accept `filterUserId`**. Web **disables** those controls while `viewingAsUser`.
- iOS now matches: `viewingCustomer = !!adminFilterUserId` → `canMutate` false. Connect, switches, nickname, KDP list/mutations off.
- KDP list/link **do** accept `filterUserId` on Nest. iOS does **not** send it. Loading admin’s KDP next to a customer’s profiles would be a scope lie. Query is disabled in view-as.

### Which Amazon profile

- Writes: Ads `profile_id`.
- View selection: `p.id` in AppContext (seller row id or Nest-mapped Ads id).
- Enable also adds that **context** id to `selectedProfileIds`. Disable removes it **after** confirm.

### One vs many

- Toggle / nickname / unlink: one profile.
- Link selected: **all** currently selected profiles replace the KDP account’s links.
- Select all: all profiles of the **current currency** (local).

### Automatic vs manual

- Enable/disable: manual.
- Admin first-customer auto-select: automatic in AppContext (existing product). Not a Nest write.
- Server may sync after enable (web fires `triggerSync`; iOS does **not**). Nest toggle itself may subscribe AMS.

---

## State truth

| State | How the UI knows |
| ----- | ---------------- |
| CURRENT | `is_enabled` from profile fetch + local `selectedProfileIds`. Switch on iff `is_enabled !== false && selected`. |
| REQUESTED | Disable waits for confirm. Enable fires immediately. |
| SAVING | Switch disabled for the Ads id in flight. Connect uses `loading`. Nickname uses `nicknameSaving`. KDP link/unlink have **no** in-button pending (P2). |
| CONFIRMED | Profile list refetch after success. No toast. |
| FAILED | `alertMutationError`. Selection rolled back on toggle. No “success” from the tap alone. |

`is_enabled !== false` treats missing `is_enabled` as on. Seller map can leave it `undefined`.

AppContext also **rewrites** selection to enabled / same-currency defaults when profiles load. That can override a failed or empty local set. Documented; not changed here.

---

## Destructive actions

| Action | Destructive style | Target named | Cancel | Double-submit | Failure |
| ------ | ----------------- | ------------ | ------ | ------------- | ------- |
| Disable | Confirm destructive | Generic (“this account”) | Yes | Switch disabled while pending | Rollback + alert |
| KDP unlink | Red Unlink + confirm | Nickname/name | Yes | none | Alert |
| KDP link | Confirm (replace) | KDP name + counts | Yes | none | Alert |
| Connect | Primary | n/a | Browser | `connectBusy` | Alert |
| Disconnect | — | — | — | — | **Not on iOS** |

Did not run these on production profiles.

---

## Credential / account actions

| Topic | Finding |
| ----- | ------- |
| SecureStore | Nest tokens only. Connect URL is not stored. |
| Logout | My Account; clears Nest tokens + admin filter. |
| Disconnect | Web `DELETE /amazon/accounts/:accountId`. iOS: **MISSING MOBILE** / web-only. |
| Reconnect | Connect Amazon again (signed-in user). |
| Partial connect | Empty list + “Connect an account at inteliads.io.” |
| Expired LWA | Not surfaced on this screen (sync/errors elsewhere). |
| Per-profile `is_enabled` | Nest pivot. Off ≠ disconnect. |
| View-as | Read profiles for customer; **no** iOS writes. |

---

## Tests

`frontend/tests/accounts-safety.test.js` — 3 pass.

- Ads `profile_id` mapping when it differs from row `id`
- View-as `canMutate` + KDP query gated
- Disable confirm + selection rollback + KDP uses mapped ids

Did not rewrite stale data-mapping tests 6 / 13.

---

## P0 (resolved this pass)

| ID | Issue | Fix |
| -- | ----- | --- |
| ACC-P0-1 | Admin view-as could Connect / toggle / nickname / load **admin** KDP and link **customer** selected ids onto it | Mutations + KDP fetch off when `adminFilterUserId` is set. Matches web. |
| ACC-P0-2 | Toggle / nickname / KDP link sent `p.id` (sometimes UUID) while Nest/web use Ads `profile_id` | `accountScope` maps writes to Ads id. Selection stays on `p.id`. |

---

## P1 (resolved or no longer ambiguous)

| ID | Status |
| -- | ------ |
| INV-ACC-1 dual write | **VERIFIED.** Accounts Switch = Nest `isEnabled` + local selection. TopBar Switch = local selection only. |
| INV-ACC-1 no disable confirm | **Fixed.** Confirm + “does not disconnect.” |
| Toggle optimistic no rollback | **Fixed.** |
| View-as KDP list | **Fixed** (not shown). |

---

## P2 / P3 (backlog — not this pass)

- KDP link/unlink no in-button pending
- Disable confirm does not show nickname
- `is_enabled` undefined treated as on
- AppContext auto-realign of selection
- Admin auto-select first customer (product)
- Appearance of RN Switch vs `@expo/ui`
- Missing disconnect UI (product / later)

---

## Backend gaps (do not implement here)

- `PATCH .../toggle` and `.../nickname` have **no** `filterUserId` (by design; view-as is read-only)
- Disconnect exists on Nest/web only
- iOS Connect does not pass a customer id (correct; must stay self)
- Chrome KDP collect stays extension-only

---

## UI requirements for the later Accounts UI QA

Not started. When that pass runs:

- Dark / small / Dynamic Type / VoiceOver on `/more/accounts`
- 44pt switches and Unlink
- Distinct guest vs view-as vs empty vs error
- Do not merge TopBar and Accounts into one control
- Do not add disconnect unless product asks
- Do not reopen Overview / Campaigns / Targets / Books

---

## Cross-screen (do not force-match)

| Pair | Classification |
| ---- | -------------- |
| Accounts Switch vs TopBar Switch | **EXPECTED DIFFERENCE** — enable vs view |
| Accounts “active” vs list data | Enable + selection + AppContext currency filter |
| Seller `id` vs Ads `profile_id` | **EXPECTED** after remap on writes |
| Overview empty “Connect” | Still pushes this route; Overview not edited |

---

## Device result

Not a UI pass. No new simulator shots.

---

## Files changed (this workstream)

- `frontend/app/more/accounts.tsx` — view-as lock, Ads-id writes, disable confirm, toggle rollback
- `frontend/src/lib/accountScope.ts` — new mapping helpers
- `frontend/tests/accounts-safety.test.js` — new
- This audit + progress / coverage / matrix pointers
