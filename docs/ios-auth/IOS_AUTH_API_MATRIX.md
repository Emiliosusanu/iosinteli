# iOS Auth / API Matrix

Traced 2026-08-25 against:

- QA iOS tree `iosapp-inteli-smart-notifications`
- Nest tree `robo_ads-smart-notifications-on-82ae`
- Live image labeled `GIT_COMMIT=8809210c` with a runtime `JwtAuthGuard` hotfix that now uses `resolveCallerFromBearer`

Do not assume shared auth. Seller Amazon login has a valid Supabase session and usually **no** Nest JWT.

## Mobile auth contract

One authenticated mobile API identity:

1. Client sends `Authorization: Bearer <token>`.
2. Prefer a live Nest access JWT when the email/password Nest session is valid.
3. Otherwise send the Supabase session access token (Amazon login).
4. Server `JwtAuthGuard` / `AuthService.resolveCallerFromBearer` verifies that bearer.
5. Server derives `userId` from the verified token. Client `userId` / `filterUserId` is not identity.
6. `filterUserId` is view-as only. `BaseController.resolveTargetUserId` ignores it unless `is_admin` RPC is true.
7. A Supabase mobile token always attaches `role: user`. Admin remains `is_admin` RPC + `AdminGuard`.
8. Guest / demo cannot mutate. View-as cannot mutate production Ads entities.
9. Authentication parity changes **who** is authenticated. It does not change mutation locks, cooldown, `remote_unknown`, reconciliation, idempotency, or Amazon write validation.

`hasNestToken()` stays Nest-JWT-only so ordinary seller **reads** keep using Supabase RLS. Nest is used for writes, Nest-only status, admin view-as reads, and the Accounts RLS-gap fallback.

## Notification gate (unchanged this workstream)

| Gate | Status |
|---|---|
| LIVE APNS DELIVERY | PASS |
| PHYSICAL DAILY PUSH | PASS |
| DAILY DEEP LINK | PASS |
| DAILY DEDUPE | PASS |
| LIVE NEW-ORDER DETECTION | PENDING NATURAL ORDER |
| NATURAL 20:00 REPORT | PENDING |

No extra physical notification was sent for this audit.

## Legend

| Column | Meaning |
|---|---|
| AUTH EXPECTED | One mobile bearer after this contract |
| CURRENT TOKEN SOURCE | What the iOS client sends after the client fix |
| SUPABASE SESSION ACCEPTED? | After server `JwtAuthGuard` fix / still `@Public` resolver |
| NEST JWT REQUIRED? | After the contract. `no` means Supabase bearer is enough |
| VIEW-AS SAFE? | Seller token cannot impersonate. Admin uses Nest JWT + `is_admin` |
| CURRENT RESULT | Seller Amazon login after client + live guard. Physical logged-in smoke still pending unlock |
| 401 RISK | Before this workstream, unless noted |
| FIX REQUIRED | Source done / live deploy still required |

401 before this workstream: every `nestApiFetch` path threw **locally** on Amazon login (`Sign out and sign in again to make changes`) because no Nest JWT left the phone.

## Matrix

| SCREEN / ACTION | ENDPOINT | READ / WRITE | AUTH EXPECTED | CURRENT TOKEN SOURCE | SUPABASE SESSION ACCEPTED? | NEST JWT REQUIRED? | VIEW-AS SAFE? | CURRENT RESULT | 401 RISK | FIX REQUIRED |
|---|---|---|---|---|---|---|---|---|---|---|
| Overview metrics / charts / books (seller) | Supabase `campaign_metrics`, royalties, top books, rules executions | READ | Supabase RLS session | Supabase anon + user JWT | n/a (not Nest) | no | yes — seller queries scoped to selected profiles; admin uses Nest bootstrap | Works today for linked profiles | none if `user_amazon_profiles` visible | no |
| Overview admin bootstrap | `GET /dashboard/bootstrap?filterUserId=` | READ | Nest admin bearer | Nest JWT only (`hasNestToken` + `adminFilterUserId`) | after guard deploy, unused for seller | yes for admin routing | yes — seller `hasNestToken` is false so this query stays disabled | admin-only | seller never hits it | no |
| Overview BidBot widget | `GET /bid-engine/status` | READ | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — `enabled: false` on Overview | not requested on Home | was local 401 if enabled | client send + server guard |
| Campaigns list | Supabase `campaigns` + metrics | READ | Supabase RLS | Supabase | n/a | no | yes | works | none | no |
| Campaign detail (seller) | Supabase `campaigns` / keywords / ad groups / product ads | READ | Supabase RLS | Supabase | n/a | no | yes | works | none | no |
| Campaign detail Nest fallback | `GET /campaigns/:id` | READ | mobile bearer | only if `hasNestToken()` | after guard deploy | no after deploy; gated on Nest JWT today | yes | unused on Amazon login | local 401 if forced | client send; keep `hasNestToken` gate |
| Ad Groups / Ad Group detail | Supabase `ad_groups` + child queries | READ | Supabase RLS | Supabase | n/a | no | yes | works | none | no |
| Targets list | Supabase `product_targets` + metrics | READ | Supabase RLS | Supabase | n/a | no | yes | works | none | no |
| Target detail (seller) | Supabase `product_targets` | READ | Supabase RLS | Supabase | n/a | no | yes | works | none | no |
| Target detail Nest fallback | `GET /product-targets/:id` | READ | mobile bearer | `hasNestToken` only | after guard deploy | no after deploy | yes | unused on Amazon login | local 401 if forced | client send; keep gate |
| Books / Book detail (seller) | Supabase products / titles / metrics | READ | Supabase RLS | Supabase | n/a | no | yes | works; KDP title integrity still a separate P1 | none | no (auth) |
| Search Terms | Supabase `search_terms` | READ | Supabase RLS | Supabase | n/a | no | yes | works | none | no |
| Search term harvest / negate | `POST /search-terms/:id/add`, `POST /search-terms/:id/negate` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — mutations ignore seller `filterUserId`; guest blocked | local 401 before | high before | client send + server guard |
| Rules list / Rule Activity | Supabase `optimization_rules`, executions | READ | Supabase RLS | Supabase | n/a | no | yes | works | none | no |
| Rule Builder create | `POST /rules` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — created as the bearer user, always disabled | local 401 before | high before | client send + server guard |
| Rule toggle / edit / delete | `PATCH /rules/:id/toggle`, `PATCH /rules/:id`, `DELETE /rules/:id` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — ownership stays in Rules service | local 401 before | high before | client send + server guard |
| Rule execution revert / reapply | `POST /rules/executions/:id/revert`, `/reapply` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes | local 401 before | high before | client send + server guard |
| BidBot status / settings / recs / log | `GET /bid-engine/status`, `/settings`, `GET /bid-recommendations/pending`, `/bid-engine/apply-log` | READ | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — seller `filterUserId` ignored; view-as uses Nest admin | local 401 before | high before | client send + server guard |
| BidBot settings save / run | `PATCH /bid-engine/settings`, `POST /bid-engine/run` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — `canMutateBidBot` blocks guest + view-as | local 401 before | high before | client send + server guard |
| BidBot apply / revert | `POST /bid-recommendations/bulk` apply/revert paths | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — write safety unchanged; auto-apply stays OFF | local 401 before | high before | client send + server guard |
| Sync status | `GET /amazon/sync/status` | READ | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes | local 401 before | high before | client send + server guard |
| Sync trigger / cancel | `POST /amazon/sync`, `POST /amazon/sync/cancel` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — plan gate + in-progress lock unchanged | local 401 before | high before | client send + server guard |
| Amazon Accounts list (RLS hit) | Supabase `user_amazon_profiles` + `amazon_profiles` | READ | Supabase RLS | Supabase | n/a | no | yes | works when links are readable | none | no |
| Amazon Accounts list (RLS miss) | `GET /amazon/profiles` | READ | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — seller cannot pass `filterUserId` without Nest admin session | `[]` before if no Nest JWT | medium | client fallback + server guard |
| Account nickname / on / off | `PATCH /amazon/profiles/:id/nickname`, `/toggle` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — view-as UI locked | local 401 before | high before | client send + server guard |
| KDP accounts / link / unlink | `GET /kdp/accounts`, `POST /kdp/accounts/:id/profiles`, `DELETE .../profiles/:pid` | READ / WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes | local 401 before | high before | client send + server guard |
| Settings notification prefs / timezone | `PUT /notifications/preferences`, `PUT /notifications/timezone` | WRITE | mobile bearer | already dual-bearer; now `nestApiJson` | already `@Public` + `resolveUserIdFromBearer` | no | yes — `notificationContract` rejects view-as notify | works today | low | folded into shared fetch |
| Settings device token | `PUT /notifications/device-token` | WRITE | mobile bearer | same | already accepted | no | yes | works today | low | folded into shared fetch |
| My Account | Supabase session + profile summary | READ | Supabase | Supabase | n/a | no | yes | works | none | no |
| `/auth/me` | `GET /auth/me` | READ | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes | unused on Amazon login Home | medium if called | server guard |
| `/auth/users` admin list | `GET /auth/users` | READ | Nest admin | Nest JWT (`hasNestToken`) | after guard deploy still 403 for seller | yes for routing | yes — seller query disabled | seller never fetches | none for seller | no |
| Amazon connect URL | `GET /auth/amazon/connect` | READ | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes | local 401 before | medium | client send + server guard |
| Amazon login URL | `GET /auth/amazon/login` | READ | anonymous (`@Public`) | no bearer; leftover Nest tokens cleared first | already `@Public` | no | n/a | local 401 before if no bearer | high on login screen | `allowAnonymous` + `nestLogout` |
| Negatives | Supabase negative keywords / product targets | READ | Supabase RLS | Supabase | n/a | no | yes | works | none | no |
| Data Map | Supabase mapping tables | READ | Supabase RLS | Supabase | n/a | no | yes | works | none | no |
| Manual bid (keyword) | `PATCH /keywords/:id/manual` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes — ownership + cooldown + Amazon confirm unchanged | local 401 before | high before | client send + server guard |
| Manual bid (product target) | `PATCH /product-targets/:id/manual` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes | local 401 before | high before | client send + server guard |
| Budget / placement | `PATCH /campaigns/:id` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes | local 401 before | high before | client send + server guard |
| Pause / enable campaign | `PATCH /campaigns/:id/state` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes | local 401 before | high before | client send + server guard |
| Pause / enable ad group | `PATCH /ad-groups/:id/state` | WRITE | mobile bearer | Nest JWT or Supabase | after guard deploy | no | yes | local 401 before | high before | client send + server guard |
| Guest / demo any mutation | none | WRITE | blocked | no bearer sent | n/a | n/a | yes | UI + `assertCanMutate` / `canWriteAmazonAds` | none | no |

## Server identity rules

| Token | Verifier | `req.user.role` | Can `filterUserId` impersonate? |
|---|---|---|---|
| Nest access JWT | `jwtService.verify` + `tokenType === access` | payload role or `user` | only if `is_admin` RPC |
| Nest refresh / untyped | rejected | — | no |
| Supabase access | `supabase.auth.getUser` | always `user` | no — seller `resolveTargetUserId` returns caller |
| Missing / invalid / expired | `401 Unauthorized` | — | no |

## Tests

- Server: `resolveCallerFromBearer`, `JwtAuthGuard`, seller `filterUserId` ignore, notifications still resolve bearer
- iOS: `pickMobileApiToken`, leftover Nest JWT ignored until `nestLogin`, leftover Nest JWT for another user dropped, Amazon login URL is public, dead Nest JWT falls back to Supabase, expired Supabase retries GET only, `hasNestToken` Nest-only, guest/view-as cannot mutate, notification routes use shared fetch

## Live deploy note

Nest `JwtAuthGuard` + `resolveCallerFromBearer` was hotfixed onto `robo-ads-backend` on 2026-08-25. Live checks:

- `GET /amazon/sync/status` missing/invalid bearer → 401
- `GET /bid-engine/status` missing bearer → 401
- `PUT /notifications/preferences` missing/invalid bearer → 401
- `GET /rules` missing/invalid bearer → 401
- health live OK
- `BIDBOT_AUTO_APPLY_ENABLED=false`
- `SMART_NOTIFICATIONS_CANARY_ONLY=true`

Previous bundle kept at `/tmp/inteliads-main-pre-mobile-auth.bak`. Original image backup remains `/tmp/inteliads-main-8809210c.bak`.

QA Release iOS build with leftover-Nest fallback + public Amazon login was installed on iPhone 17 Pro Max (`pickMobileApiToken`, `allowAnonymous`, `nestSessionFlagAllowsWrites`, `canRetryMobileRequestAfter401` present in `main.jsbundle`). Physical logged-in screen smoke is still blocked: the device is locked and launch is denied.
