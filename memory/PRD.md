# inteliads · Product Requirements Document (PRD)

## 1. Product Brief

**Elevator pitch**: inteliads is a premium, mobile-first Amazon Ads performance manager that
turns complex advertising data into Smart Clarity — a single headline metric per screen, a
breakdown of what's driving it, an immediate action you can take, and a drill-down if you want
to go deeper. Built for solopreneurs, KDP publishers, and small Amazon advertising teams who
live on their phone.

**Tagline**: Smart Clarity for Amazon Ads.

**Differentiators**
- Net Profit, not just Spend — every dashboard reconciles ad cost against royalties.
- Driver breakdown next to every KPI (funnel, placements, hours, products).
- Mobile-first information density borrowed from iOS 17/18 design language.
- Multi-profile / multi-country / multi-currency aware. Never blends currencies silently.

**Personas**
- KDP / book publishers (primary, multi-country profiles).
- Solo Amazon sellers running 1–5 marketplaces.
- Agency analysts checking client accounts on the go.

**Top JTBD**
- "Is my ad spend making me money right now?"
- "Which campaign / keyword / ASIN should I act on today?"
- "Are my automation rules doing what I expect?"

**MVP scope (Must / Should / Could)**
- *Must*: 5-tab navigation, Overview dashboard with all 12 widgets, Campaign list + detail,
  Targeting (Keywords/Products), Products (grouped by ASIN), profile selector, date-range,
  Supabase mapping.
- *Should*: Search Terms list, Negative Targeting, Automation rules + history, Settings with
  bid guardrails, Account screen with sign-out.
- *Could*: Mutations (pause/resume, bid edits), AI bid recommendations, push notifications,
  CSV export, anomaly engine, on-device sync queue.

## 2. Information Architecture

Five bottom tabs:
1. **Overview** — smart-clarity dashboard
2. **Campaigns** — list → detail
3. **Targeting** — segmented Keywords / Products
4. **Products** — grouped by ASIN/SKU
5. **More** — Ad Groups, Negative Targeting, Search Terms, Automation,
   Amazon Accounts, Settings, Account

Deep-linkable routes (`expo-router`):
- `/campaign/[id]` — campaign detail with ad groups, keywords, products
- `/more/ad-groups`, `/more/automation`, `/more/accounts`, `/more/settings`, `/more/account`,
  `/more/negative-targeting`, `/more/search-terms`
- `/auth/login`, `/auth/signup`

Back navigation follows `NavigationStack` semantics; tabs reset on long-press of icon (default
expo-router behavior).

## 3. Design System

Stored in `/app/frontend/src/lib/theme.ts` and `/app/design_guidelines.json`.

- **Colors (light/dark)**: iOS-system inspired — system blue primary, semantic
  green/orange/red for ACOS tone, purple for product entity, gray for inactive.
- **Typography**: 11-step Apple HIG scale (largeTitle → caption2) with metric_massive (44pt) for
  hero KPIs. System font on iOS, Roboto on Android.
- **Spacing**: 8pt grid (4/8/12/16/24/32/40).
- **Radii**: 8 / 12 / 16 / 22 / pill.
- **Shadows**: 2 levels (card, floating), platform-aware in light/dark.
- **Components**: `KpiTile`, `Pill`, `SectionCard`, `EmptyState`, `Skeleton`, `ToneDot`,
  `BudgetRing`, `Funnel`, `Sparkline`, `PerformanceChart`, `Heatmap`, `TopBar`, `SubScreen`.
- **Tone helper** `acosTone(value, target)` returns good / warning / danger / inactive.

## 4. Screen Specs (with Data Contract + Supabase mapping)

### A) Overview
- Widgets: Net Profit hero (area chart), 4 KPI tiles (Spend/Sales/Orders/ACOS) with deltas,
  Budget Pace ring, Conversion Funnel, Spend vs Sales multi-series chart, Top Campaigns by
  Net, Top Keywords by ROAS, Best-hours heatmap, Sync health tile.
- Data: `campaigns` (total_*), `campaign_metrics` (date-filtered), `keywords` (top 5 by ROAS),
  `profile_sync_logs` (most recent).
- Aggregation: `aggregateTotals()` + `aggregateDailyMetrics()` in `/src/lib/queries.ts`.
- Net Profit formula: `total_sales × royaltyRate% − total_spend`, default 70%.

### B) Campaigns list
- High-density card rows: tone dot + name + state pill, type/targeting pills, daily budget,
  Spend / Sales / Orders / ACOS / ROAS metrics.
- Filters: state (all/enabled/paused), type (SP/SB/SD), search by name.
- Source: `campaigns` filtered by `amazon_profile_id IN selectedProfileIds`.

### C) Campaign detail
- Hero KPIs (Net + ACOS), state/type/targeting pills, 14-day performance chart, conversion
  funnel, ad groups list, top keywords, advertised products.
- Sources: `campaigns`, `ad_groups`, `keywords`, `product_ads`, `campaign_metrics`.

### D) Targeting
- Segmented control: Keywords | Products.
- Keywords source: `keywords` (with match_type pills).
- Products source: `product_targets` (with expression_type pills).

### E) Products
- Source: `product_ads`, grouped client-side by ASIN.
- Sort options: net / spend / sales / acos.

### F)–K) More sub-screens
- Ad Groups → `ad_groups`
- Negative Targeting → `negative_keywords`
- Search Terms → `search_terms` (with Add as keyword / Negate actions, currently stubs)
- Automation → `optimization_rules` + `rule_execution_history`
- Amazon Accounts → `amazon_profiles` + `user_amazon_profiles`
- Settings → local persisted (royalty rate, guardrails, budgets, target ACOS)
- Account → `auth.users` + sign-out

## 5. Supabase Architecture

- **Project**: `https://sjdlkprlkaweyuiaigix.supabase.co` (existing, no schema modifications).
- **Auth**: `@supabase/supabase-js` email/password + session storage via `AsyncStorage`.
  Email confirmation enforced by project. Guest mode added on login screen to bypass
  confirmation friction since anon key has full read access.
- **Realtime**: not used; `ws` polyfill loaded only when Node runtime has no global WebSocket
  (SSR pre-render).
- **Client**: `/src/lib/supabase.ts` with SSR-safe no-op storage adapter so Node pre-render
  doesn't throw `window is not defined`.
- **Data layer**: `/src/lib/queries.ts` provides typed read functions:
  - `fetchAmazonProfiles`, `fetchCampaigns(profileIds, opts)`, `fetchCampaignById(id)`,
    `fetchAdGroups(profileIds, campaignId?)`, `fetchKeywords(profileIds, opts)`,
    `fetchProductTargets`, `fetchProductAds`, `fetchSearchTerms`, `fetchNegativeKeywords`,
    `fetchCampaignMetricsRange`, `fetchOptimizationRules`, `fetchRuleExecutions`,
    `fetchProfileSyncLogs`.
- **Caching**: React Query with `staleTime: 60s`; refetched on pull-to-refresh.
- **Currency**: never blends across `currency_code`. Primary currency derived as the most
  common currency among selected profiles.
- **Mutations**: not implemented in MVP (read-only stubs in Search Terms screen).

## 6. Component Library

In `/src/components/`:
- `Primitives.tsx` — `KpiTile`, `Pill`, `SectionCard`, `EmptyState`, `Skeleton`, `ToneDot`.
- `Charts.tsx` — `NetProfitChart`, `Funnel`, `BudgetRing`, `Sparkline`, `PerformanceChart`,
  `Heatmap`. Powered by `react-native-gifted-charts`.
- `TopBar.tsx` — sticky bar with Profile selector + Date-range picker + optional right action.
- `SubScreen.tsx` — navbar with back button for More drill-downs.

## 7. App Store Polish Checklist (MVP status)

- [x] Skeleton / loading states (KPI tiles, lists, activity indicators).
- [x] Empty states (no profile, no data, no campaigns).
- [x] Pull-to-refresh on every list and the Overview dashboard.
- [x] Safe-area insets via `SafeAreaProvider` + `SafeAreaView`.
- [x] Keyboard handling via `KeyboardAvoidingView` on auth screens.
- [x] testID on every interactive control.
- [x] Light/Dark mode via `useColorScheme`.
- [ ] Offline cache hydration (partial — React Query default in-memory).
- [ ] Anomaly engine + push notifications.
- [ ] Localized strings.

## 8. Smart business enhancement

**Net Profit per profile / per book** — surfacing royalty-aware profitability directly in the
mobile UI is the single biggest conversion lever for KDP publishers, who currently have to
build spreadsheets to reconcile Amazon Ads spend against their royalty rate. Putting this
front-and-center on Overview, with a configurable royalty rate in Settings, differentiates
inteliads from every other Amazon Ads mobile companion that just reports ACOS/ROAS.

## 9. File map

```
/app/frontend
├── .env                          EXPO_PUBLIC_SUPABASE_URL + ANON_KEY
├── app/                          expo-router file-based routes
│   ├── _layout.tsx               Providers + RouteGuard
│   ├── index.tsx                 Auth router
│   ├── auth/
│   │   ├── login.tsx
│   │   └── signup.tsx
│   ├── (tabs)/                   5 bottom tabs
│   │   ├── _layout.tsx
│   │   ├── index.tsx             Overview
│   │   ├── campaigns.tsx
│   │   ├── targeting.tsx
│   │   ├── products.tsx
│   │   └── more.tsx
│   ├── campaign/[id].tsx         Drill-down detail
│   └── more/
│       ├── ad-groups.tsx
│       ├── negative-targeting.tsx
│       ├── search-terms.tsx
│       ├── automation.tsx
│       ├── accounts.tsx
│       ├── settings.tsx
│       └── account.tsx
└── src/
    ├── components/               Primitives, Charts, TopBar, SubScreen
    ├── contexts/                 AuthContext, AppContext
    ├── lib/                      theme, supabase, types, queries, format
    └── utils/storage/            (pre-existing)
```
