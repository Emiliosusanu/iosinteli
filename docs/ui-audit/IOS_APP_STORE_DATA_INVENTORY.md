# InteliAds iOS — App Store data inventory

Date: 2026-08-23

Technical inventory from current source only. This is **not** a completed App Store Connect privacy questionnaire.

`NSPrivacyTracking` in `frontend/app.json` / `PrivacyInfo.xcprivacy` is `false`. No ATT / IDFA API is used.

---

## Data the app handles

| Data | Why | Source evidence | Linked to identity? | Tracking? |
| --- | --- | --- | --- | --- |
| Account email | Sign in / My Account display | Supabase `user.email`; privacy manifest EmailAddress | Yes | No |
| InteliAds user id | Queries, notification payload `userId`, settings | Supabase `user.id`; privacy manifest UserID | Yes | No |
| Password | Login / signup / in-app reset if a session exists | Supabase auth; not persisted in AsyncStorage | Yes | No |
| Nest access / refresh tokens | Amazon mutations | SecureStore keys `inteliads.rulesApi.accessToken` / `refreshToken` | Yes | No |
| Supabase session | Restore login | AsyncStorage (Supabase client) | Yes | No |
| Amazon Ads profiles, campaigns, keywords, bids, budgets, search terms | Operator daily work | Nest + Supabase reads; Nest writes | Yes (account) | No |
| Imported KDP royalties / orders / book rows | Profit and book screens | Server-imported tables; iPhone does not collect KDP | Yes | No |
| Selected profile ids / admin view-as id | View scope | AsyncStorage `inteliads.selectedProfiles`, `inteliads.adminFilterUserId` | Yes | No |
| Notification preferences | Local alert toggles | AsyncStorage + best-effort `user_settings.notifications` | Yes | No |
| Native APNs device token | Best-effort upsert | `getDevicePushTokenAsync` → `device_push_tokens` | Yes | No |
| Local alert state | Dedup orders / overspend / books | AsyncStorage `inteliads.alertState` | Yes | No |
| Date range / UI prefs | Reporting window | AppContext persistence | No / weak | No |

---

## Not found in current iOS source

| Item | Evidence |
| --- | --- |
| Crash / analytics SDK (Sentry, Firebase, Amplitude, Mixpanel, PostHog, Clarity) | No package or import |
| StoreKit / IAP purchase tokens | No StoreKit |
| Camera / photos / location / contacts / microphone | No usage strings; no APIs |
| Advertising identifier | Tracking false |
| KDP cookies / session scrape | Not present (Chrome helper is web-only) |

---

## Third-party destinations (from source, not a legal review)

| Destination | Purpose |
| --- | --- |
| Supabase (`EXPO_PUBLIC_SUPABASE_URL`) | Auth, reads, optional settings / push-token row |
| InteliAds Nest (`EXPO_PUBLIC_RULES_API_URL`) | Profiles, sync, BidBot, Amazon mutations, Amazon OAuth URL |
| `dashboard.inteliads.io` | Password-reset finish; billing web handoff |
| Amazon (browser) | LWA connect / login URL returned by Nest |
| `images-na.ssl-images-amazon.com` | Optional ASIN cover fallback |

---

## Already declared in the Expo privacy manifest

- Email address — App Functionality, linked, not tracking
- User ID — App Functionality, linked, not tracking
- Accessed APIs: UserDefaults, File Timestamp, System Boot Time, Disk Space (required-reason codes in `app.json`)

Device push token is **not** listed as a collected type in the current manifest. Confirm with counsel before App Store submission if the upsert ships.

---

## Diagnostics

Release source logs structural warnings only (auth hydration, missing env, Nest login status, storage op failure). Notification `devWarn` is `__DEV__` only. `EXPO_PUBLIC_DEBUG_DATA_SCOPE` logs counts only when set to `true` — must stay unset in release.
