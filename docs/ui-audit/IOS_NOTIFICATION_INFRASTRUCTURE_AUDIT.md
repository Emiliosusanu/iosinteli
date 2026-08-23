# InteliAds iOS — Notification Infrastructure Audit

Date: 2026-08-23

`NOTIFICATION INFRASTRUCTURE: PASS` at the product / code-contract level.

Preserved by `FINAL RELEASE-WIDE REGRESSION: PASS` (2026-08-23). Remote delivery is still not live.

Remote delivery is **not implemented** on Nest and is **not live-verified**. Settings does not claim otherwise.

This repository is the iOS app only. No Nest sender, Expo Push API client, or notification worker exists here.

---

## Architecture

```text
Settings toggles
    ↓
AppContext.setNotifications
    ↓
AsyncStorage inteliads.notifications   ← authoritative on this iPhone
    ↓ (best-effort)
user_settings.notifications            ← cross-device, may fail silently

runAlertCheck (foreground 5 min / AppState active / expo-background-task)
    ↓
session + selectedProfiles + not view-as + pref on
    ↓
Supabase campaign_metrics / campaigns.budget / top books
    ↓
expo-notifications scheduleNotificationAsync (local, trigger null)

Device token
    ↓
getDevicePushTokenAsync (native APNs token, not Expo push token)
    ↓
inteliads.devicePushToken (local, userId attached)
    ↓
best-effort upsert device_push_tokens
    ↓
backend sender  ← MISSING

Notification tap
    ↓
parseNotificationPayload(event, userId, asin?)
    ↓
allowlisted route (Campaigns / Book / Settings / tabs)
    ↓
RouteGuard only while authenticated
```

Missing links (explicit):

- No Nest/Expo Push send path
- No invalid-token cleanup from a provider
- No notification history / inbox
- No Rule / BidBot / Sync notification types
- Background refresh is opportunistic; force-quit evaluation is not guaranteed

---

## Notification types

| Notification type | Trigger | Local/Remote | App open | Background | Terminated | Deep link |
| ----------------- | ------- | ------------ | -------: | ---------: | ---------: | --------- |
| Test | Settings “Send a test on this iPhone” | LOCAL | Yes | n/a | n/a | `/more/settings` |
| New orders | Today’s **Ads-attributed** orders from `campaign_metrics` exceed last notified count | LOCAL | Yes (5 min + resume) | Best-effort BG task | Not guaranteed | `/(tabs)/campaigns` |
| Book needs attention | Top-5 books today: sales>0 and ACoS > break-even × 1.1 | LOCAL | Yes | Best-effort | Not guaranteed | `/product/{ASIN}` or Books |
| Campaign overspending | Today Ads spend > **sum of enabled campaign daily budgets** × (1 + threshold/100) | LOCAL | Yes | Best-effort | Not guaranteed | `/(tabs)/campaigns` |
| Remote APNs / Expo push | — | **NOT IMPLEMENTED** | — | — | — | — |
| Rules / BidBot / Sync events | Product-map wishlist only | **NOT IMPLEMENTED** | — | — | — | — |

Do not invent extra types.

---

## Local vs remote

| Type | Class |
| ---- | ----- |
| Test | LOCAL |
| New orders | LOCAL |
| Book needs attention | LOCAL |
| Campaign overspending | LOCAL |
| Remote push of any type | NOT IMPLEMENTED |

A stored APNs token is **not** remote delivery. A background task is **not** terminated-app proof.

### New orders

```text
SOURCE            campaign_metrics for selected profiles, device-local today
CHECK FREQUENCY   foreground 5 min + AppState active + BG task (min 15 min, opportunistic)
DEDUP             inteliads.alertState.ordersNotified for that local day
PAYLOAD           event=new-orders, userId
DEEP LINK         Campaigns list (no per-order entity id exists)
```

Not KDP orders. Body says “Ads-attributed orders”.

### Book needs attention

```text
SOURCE            fetchTopBooksRange today, limit 5
TRIGGER           sales > 0 AND breakeven_acos > 0 AND acos > breakeven_acos * 1.1
KDP MISSING       no break-even → no alert (not treated as $0 profit)
DEDUP             once per book key (asin/sku) per local day
PAYLOAD           event=book-attention, userId, asin when valid
DEEP LINK         /product/{ASIN} or Books list
```

Financial formulas were not changed.

### Campaign overspending

Settings contract (unchanged):

`today Ads spend > sum(enabled campaign daily budgets) * (1 + threshold/100)`

Not a per-campaign Amazon cap. Currency in the body is still `$` (P2). Dedup: once per local day (`spendAlertDay`).

---

## Preference persistence

```text
UI toggle
→ AppContext state
→ AsyncStorage inteliads.notifications   (authoritative for evaluation)
→ saveUserSetting(user_id, "notifications") best-effort
→ runAlertCheck reads AsyncStorage
```

Remote `user_settings` can override local after fetch. If the remote write fails, local still works. No fake “synced” banner.

**Multi-device:** Device B sees Device A prefs only if `user_settings` write/read succeeds. Local-only Device A state does not propagate. PRODUCT/DATA gap — not over-engineered this pass.

---

## Permissions

| iOS / Expo status | App handling |
| ----------------- | ------------ |
| NOT DETERMINED | No launch prompt. Prompt on toggle-on or Send a test |
| AUTHORIZED / granted | Alerts can schedule; token registration attempted |
| DENIED | Prefs stay saved; no request loop; Open iOS Settings row |
| PROVISIONAL / EPHEMERAL | Treated as not granted unless `granted` is true |

Preferences ≠ OS delivery permission. Settings footer already said so.

---

## Background execution

- Task: `io.inteliads.app.background-refresh` via `expo-background-task` + TaskManager
- Info.plist identifier: `com.expo.modules.backgroundtask.processing` (Expo module)
- Modes: `fetch`, `processing`, `remote-notification`
- `minimumInterval: 15` minutes — iOS may delay or skip
- Needs persisted session + `inteliads.selectedProfiles` (AsyncStorage, available after relaunch)
- Unregistered when all three prefs are off
- Re-registered on configure when any pref is on
- Empty `INTELIADS_NOTIFICATION_TASK` remains a no-op OS hook

Do not claim exact timing.

---

## Terminated-app behavior

| State | Local `runAlertCheck` | Remote push |
| ----- | --------------------- | ----------- |
| Foreground | Yes | n/a |
| Backgrounded / suspended | Possible if iOS runs BG refresh | Not implemented |
| User force-quit | **Not guaranteed** (iOS often will not relaunch) | Would be required for reliable delivery |
| OS terminated | Same as force-quit — opportunistic only | Not implemented |

Only remote push could reliably reach a force-quit user. That sender does not exist.

---

## Push token registration

```text
TOKEN TYPE                 Native APNs (getDevicePushTokenAsync), not getExpoPushTokenAsync
REGISTRATION               registerForPushAsync after permission granted
PROJECT ID                 Not used (no Expo push service)
STORAGE                    inteliads.devicePushToken { token, type, userId, platform, updatedAt }
USER ASSOCIATION           user_id on upsert; userId in local blob
DEVICE ASSOCIATION         token string (onConflict token)
LAST UPDATED               ISO timestamp locally + updated_at remotely if table exists
```

Tokens are never printed in this audit. Registration retries on next launch / pref configure when permission is granted.

---

## Token lifecycle

| Event | Behavior |
| ----- | -------- |
| First grant | Register + local store + best-effort upsert |
| Reinstall | New token; old row left until provider cleanup (no sender) |
| User B on same device | Previous user row deleted when previous.userId ≠ current; upsert for B |
| Sign-out | `clearNotificationIdentity`: cancel/dismiss locals, clear last response, delete matching token row, drop local token + alert state |
| Account switch | AppContext resets prefs to defaults, clears identity, then remote prefs may load |

A leftover Notification Center banner from User A cannot open User A’s book while User B is signed in (`wrong-user` → tabs). Queries remain signed-in scoped.

---

## Backend remote sender

**TOKEN REGISTRATION ONLY** (best-effort). **NO REMOTE PUSH IMPLEMENTATION** in this repo or any Nest path searched (`sendPush`, Expo Push, APNs provider, notification worker).

`REMOTE PUSH: BLOCKED BY DEPLOYMENT` — needs Nest sender, APNs keys, production entitlements (`aps-environment` is currently **development**), physical-device verification.

Do not mark `REMOTE PUSH: PASS`.

---

## Deep-link routing

`data.url` is no longer trusted.

| Event | Payload | Route | Fallback |
| ----- | ------- | ----- | -------- |
| test | event, userId | `/more/settings` | tabs if wrong user |
| new-orders | event, userId | `/(tabs)/campaigns` | tabs |
| campaign-overspend | event, userId | `/(tabs)/campaigns` | tabs |
| book-attention | event, userId, asin? | `/product/{ASIN}` | Books list if no ASIN |
| malformed / unknown | — | `/(tabs)` | — |
| logged out | OS last-response kept until auth | RouteGuard waits; then allowlist | Auth gate, no bypass |
| wrong user | userId mismatch | `/(tabs)` (User B’s Overview) | never User A entity |

Missing campaign/book after navigation uses existing Not Found / Retry.

Post-login destination restore after sign-out clears last-response: **P2** (cleared on purpose to stop cross-user replay).

---

## User / profile scope

- Evaluation uses **selected** profile IDs, not every connected profile.
- Admin view-as (`inteliads.adminFilterUserId`) **skips** `runAlertCheck` so customer Ads are not alerted on the admin’s phone (matches Settings view-as copy).
- Guest: no evaluation; test row locked.

---

## Deduplication

Persisted in `inteliads.alertState` (survives restart):

- New orders: can fire again the same day when the Ads order count increases (delta). Replacing identifier `io.inteliads.new-orders.{day}` updates the same banner instead of stacking endlessly.
- Overspend: once per local day.
- Book: once per key per local day.

A campaign that stays over budget for 24 hours does **not** produce 20 identical banners. Next local day can fire once more. Acceptable.

No notification history screen.

---

## Privacy

Lock-screen copy may include book title + ACoS, Ads order counts, and a `$` overspend percent vs summed budget. No tokens or API secrets. No extra spend/order fields were added.

---

## Device evidence

| Check | Status | Evidence |
| ----- | ------ | -------- |
| LOCAL NOTIFICATION DEVICE QA | PASS (prior Settings UI) | Settings test row + footer; this pass did not re-walk Settings visually |
| REMOTE PUSH CODE CONTRACT | TOKEN REGISTRATION ONLY | `notifications.ts` |
| REMOTE PUSH LIVE DELIVERY | NOT LIVE-VERIFIED / BLOCKED BY DEPLOYMENT | No sender; simulator cannot prove APNs |

---

## Production / release requirements

- Release entitlements must set `aps-environment` to production when a sender exists
- Dev Client vs release: token and background task must be rechecked on a store build
- Physical device required for live APNs
- Do not treat Settings test as remote proof

---

## P0 / P1

| ID | Issue | Result |
| -- | ----- | ------ |
| N-P0 | Cross-user token / tap leakage | **Fixed** — userId on payload, detach on sign-out/switch, wrong-user route |
| N-P1 | Taps always `/(tabs)` / arbitrary `data.url` | **Fixed** — allowlisted event routes |
| N-P1 | Auto permission prompt on hydrate because defaults are on | **Fixed** — prompt only on toggle or test |
| N-P1 | View-as could evaluate customer Ads | **Fixed** — skip when admin filter set |
| — | Remote sender missing | **Not a false PASS** — documented BLOCKED BY DEPLOYMENT |

---

## Deferred gaps

- Nest/APNs sender + invalid token cleanup
- Physical-device remote delivery
- Cross-device pref sync reliability
- Device-local day vs profile timezone (P2)
- Hardcoded `$` in overspend body (P2)
- Top-5 books only (P2)
- Post-login restore after sign-out last-response clear (P2)
- Product-map types (Rules, BidBot, Sync, digest) — not implemented
- Notification history screen — not added
