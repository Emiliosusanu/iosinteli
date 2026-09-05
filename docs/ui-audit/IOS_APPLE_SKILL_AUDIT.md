# InteliAds iOS — Apple Skill Audit

Date: 2026-08-22  
Skill repo: `claude-code-apple-skills-main` (inside this project; not copied into `.claude/skills/`)  
Stack: React Native + Expo. SwiftUI examples were translated, not implemented.

This supplements `IOS_UI_PROGRESS.md` and `IOS_SCREEN_QA_MATRIX.md`. It does not reset completed workstreams.

Decision values: `FIX` · `INTENTIONAL INTELIADS DEVIATION` · `FOLLOW-UP` · `COMPLIANT`

---

## Search and filter (Apple vs product)

| | |
| --- | --- |
| **APPLE RECOMMENDATION** | One Search tab or a search field in the **bottom** toolbar; Cancel while focused; recent searches; scope bar; tokens supplement visible filters; empty search uses Content Unavailable. Non-destructive pickers prefer a **menu** next to the tap, not a dimming sheet. |
| **INTELIADS PRODUCT REQUIREMENT** | Ads operators change date, account, state, and sort constantly. Search is one control among several. Bottom search would sit under a 5-tab bar and fight thumb reach for the tab bar itself. Recent-search chrome would hide rows. |
| **DECISION** | Keep **top** `IOSSearchBar` + visible All/Active/Paused. Sort stays one tap away (page sheet), with a dismissible chip when non-default. Clear button (`clearButtonMode`) instead of a Cancel affordance. No recent-search UI. |

`INTENTIONAL INTELIADS DEVIATION` — power-user density. Do not “fix” this to WWDC26 Mail-style search unless product asks.

---

## Screen table

| Screen | Apple Guideline | Current | Decision | Priority | Status |
| ------ | --------------- | ------- | -------- | -------- | ------ |
| Overview | First viewport shows business state, not decoration | Was a giant Net profit hero + empty illustration | `FIX` — compact Royalties − spend + 2×2 MetricStrip | P1 | Fixed 2026-08-22 UI pass |
| Overview | Missing ≠ zero | `$0` royalties / −spend before data audit; UI now `—` + caption | `COMPLIANT` | P0 | Held from data audit |
| Overview | Color not the only status | Missing uses caption + `—`; spend `$0` is unlabeled as failure | `COMPLIANT` | — | Keep |
| Overview | 44pt targets | Account / date / Books / bleeders / blur ≥ 44 | `FIX` | P1 | Fixed this pass |
| Overview | Combined VoiceOver labels | Headline + strip + book/bleeder rows labeled in code | `FOLLOW-UP` | P2 | VO not spoken this pass |
| Overview | Reduce Motion | Period fade skipped when reduce-motion is on | `COMPLIANT` | — | Keep |
| Overview | Charts need a nearby text equivalent | Chart only when KDP exists; net number is the summary | `COMPLIANT` | — | Keep |
| Overview | Search in bottom toolbar | No search; Month/Week stepper is the date control | `INTENTIONAL INTELIADS DEVIATION` | — | Keep (data audit) |
| Ad Groups list | 44pt tap targets | Sort chip was ~24pt; Done was text + 8pt slop | `FIX` — chip and Done now `minHeight` 44 | P1 | Fixed this pass |
| Ad Groups list | Icon-only control needs a label | Sort button had a label; added role + hint | `FIX` | P1 | Fixed this pass |
| Ad Groups list | Combined row label + hint | Row spoke metrics; now also “Opens ad group details” | `FIX` | P2 | Fixed this pass |
| Ad Groups list | Search in bottom toolbar | Top search + state segment | `INTENTIONAL INTELIADS DEVIATION` | — | Keep |
| Ad Groups list | Menu for non-destructive sort | Page sheet (same as Campaigns/Targets) | `INTENTIONAL INTELIADS DEVIATION` | P2 | Keep for list consistency |
| Ad Groups list | Pause is destructive-adjacent | `Alert` Pause (destructive) + Cancel | `COMPLIANT` | — | Keep |
| Ad Groups list | Empty / error | Distinct empty copy + `RetryState` | `COMPLIANT` | — | Keep |
| Ad Groups list | Color not the only status | Verdict text + `ToneDot` + switch | `COMPLIANT` | — | Keep |
| Ad Groups list | Reduce Motion | No entrance stagger; list animation skipped | `COMPLIANT` | — | Keep |
| Ad Groups list | Safe area | `SubScreen` + stack header + date bar | `COMPLIANT` | — | Keep |
| Ad Groups list | Swipe actions for pause | Switch on the row instead | `INTENTIONAL INTELIADS DEVIATION` | P2 | Switch is more obvious |
| Campaigns list | Same sort chip < 44pt | Chip + Done now `layout.minTap`; label `Clear sort. Currently {label}` | `FIX` | P1 | Device PASS 2026-08-22. Spend chip 44pt; clear verified |
| Campaigns list | Top search + state up, sort sheet | Matches Ad Groups | `INTENTIONAL INTELIADS DEVIATION` | — | Keep |
| Targets list | Filters in sheet; type + search up | High-density targeting | `INTENTIONAL INTELIADS DEVIATION` | — | Keep |
| Targets list | Filter button 36 + 4 slop | Effective 44 | `COMPLIANT` | — | Keep |
| Targeting Detail | Semantic type + verdict, not badge wall | Identity + `EntityBidControl` | `COMPLIANT` | — | Keep |
| Campaign Detail | Hierarchy / first viewport | Identity, verdict, budget, Outcome first | `COMPLIANT` | — | Keep |
| Campaign Detail | Placement % vs performance | Labeled separately | `COMPLIANT` | — | Keep |
| Campaign Detail | Destructive pause | Existing confirm | `COMPLIANT` | — | Keep |
| All completed lists | `MetricStrip` wraps, no shrink | 4→2→1 | `COMPLIANT` | — | Keep |
| All completed lists | Semantic colors | Theme tokens, no new hex | `COMPLIANT` | — | Keep |
| SubScreen / lists | Nav title uses fixed 17/600 | Stack header; Large Content Viewer is system | `ACCEPTABLE` | P2 | System bar |
| Theme | `text_secondary` / `text_tertiary` opacity | Light `text_tertiary` `#3C3C434D` on white ≈ 2.0:1 | `FOLLOW-UP` | P2 | Confirmed on device pixels. Readable. Not a theme rewrite this pass |
| IOSSearchBar | System search anatomy | Magnifier + placeholder + clear; no Cancel | `INTENTIONAL INTELIADS DEVIATION` | P2 | Keep |
| App | XCUITest `performAccessibilityAudit` | Expo / RN — no XCUITest suite | `FOLLOW-UP` | P2 | Not this stack |
| App | Simulator screenshot of Ad Groups | Existing `frontend/ios` + Metro `--dev-client` | `FOLLOW-UP` | — | Ad Groups list rendered empty (Active). Ad Group Detail rendered with `?name=` |
| Ad Group Detail | Identity + verdict + state before search/tabs | Was pills + param metrics, no verdict/campaign | `FIX` | P1 | Fixed this pass |
| Ad Group Detail | Parent campaign visible, secondary | `ParentLinks` when `campaign_id` exists; name unknown | `INTENTIONAL INTELIADS DEVIATION` | — | DATA/BACKEND GAP: no `campaign_name` |
| Ad Group Detail | Editable default bid | `default_bid` shown read-only; no update API | `INTENTIONAL INTELIADS DEVIATION` | — | Do not invent Edit |
| Ad Group Detail | Search in bottom toolbar | Search stays above Targets/Terms/History | `INTENTIONAL INTELIADS DEVIATION` | — | Same as other lists |
| Ad Group Detail | Child row 44pt + semantic label | Compact name / ACoS / spend / orders | `FIX` | P1 | Fixed this pass |
| Ad Group Detail | Section vs screen errors | Child RetryState; identity from params if present | `FIX` | P1 | Fixed this pass |
| Ad Group Detail | Funnel 800 | Funnel not on this screen | `COMPLIANT` | — | No Charts.tsx change |
| Books List | Combined row label + hint | Row had no label; cover could announce URL | `FIX` | P1 | Combined label + “Opens book details”; cover hidden |
| Books List | Search empty vs no data | One generic empty | `FIX` | P1 | Search / range / no-account copy split |
| Books List | Reduce Motion | Staggered card entrance + ungated sort animation | `FIX` | P1 | Entrance removed; sort + cover fade gated |
| Books List | Identity vs ASIN | ASIN under title at caption weight | `FIX` | P1 | ASIN off list; title wraps 3 lines |
| Books List | Search in bottom toolbar | Top search + immediate sort segments | `INTENTIONAL INTELIADS DEVIATION` | — | Same as Campaigns; 4 high-frequency sorts stay visible |
| Books List | Menu for sort | `IOSSegmentedControl` (already wraps `@expo/ui` Picker) | `INTENTIONAL INTELIADS DEVIATION` | — | Do not add a third chrome row / Campaigns-style chip |
| Books List | Color not the only status | Verdict pill + profit tone + ACoS color | `COMPLIANT` | — | Keep |
| Book Detail | Identity + economics before child list | Was ads-only totals + “N campaigns in this book” | `FIX` | P1 | Book row economics (same `products-range` cache) + campaigns section |
| Book Detail | Combined labels | Header and campaign rows unlabeled | `FIX` | P1 | Header group + campaign hint “Opens campaign details” |
| Book Detail | Section vs screen errors | Campaign `isError` blanked the whole book | `FIX` | P1 | Identity stays; campaign `RetryState` |
| Book Detail | Loading blanks identity | Spinner hid params cover/title | `FIX` | P1 | Params identity first; spinner only on campaigns |
| Book Detail | Empty campaigns | “No campaigns” / “None in this period.” | `FIX` | P2 | “No campaigns in this period” + date/link copy |
| Book Detail | Search in bottom toolbar | Date stays in SubScreen bar | `INTENTIONAL INTELIADS DEVIATION` | — | Same as other details |
| Book Detail | Format/edition | No format field on `TopBookRow` | `INTENTIONAL INTELIADS DEVIATION` | — | DATA/PRODUCT GAP — ASIN only |
| Book Detail | Long title wraps | Title sat on one line beside Profit | `FIX` | P1 | `alignItems: flex-start` + header `width: 100%`; `numberOfLines={3}` |
| Search Terms List | Combined row label + hint | Rows unlabeled; staggered entrance | `FIX` | P1 | Label + “Opens search term details”; stagger removed |
| Search Terms List | First viewport / stacked filters | Search + two segment rows + summary card | `FIX` | P1 | Sort moved to sheet + chip (Campaigns pattern) |
| Search Terms List | Distinct empty / error | Generic “No search terms”; no RetryState | `FIX` | P1 | Search / filter / period copy; RetryState when empty |
| Search Terms List | Reduce Motion | Ungated LayoutAnimation + entrance | `FIX` | P1 | Animation gated; entrance removed |
| Search Terms List | Search in bottom toolbar | Top search + immediate All/Converting/No orders | `INTENTIONAL INTELIADS DEVIATION` | — | Same as Campaigns / Books |
| Search Terms List | Menu for sort | Page sheet | `INTENTIONAL INTELIADS DEVIATION` | P2 | Keep list-consistent with Campaigns |
| Rules List | Color not the only status | Enabled was green icon + Switch only | `FIX` | P1 | Semantic Enabled/Disabled text; last-run health is a separate line |
| Rules List | Combined row label + hint | Rows unlabeled; “Tap to edit” | `FIX` | P1 | Name + state + scope + When/Then + last run; hint “Opens the rule editor.” |
| Rules List | Icon-only create | Header + had no label; hitSlop 8 | `FIX` | P1 | Optional SubScreen label + 44pt; Rules passes “New rule” |
| Rules List | Distinct empty / error | Error showed “No rules yet”; no RetryState | `FIX` | P1 | Account / none yet / RetryState; refresh keeps cache |
| Rules List | Enable is activation | Confirm Enable; disable immediate | `COMPLIANT` | — | Do not remove Enable friction |
| Rules List | Search in bottom toolbar | No search on this screen | `INTENTIONAL INTELIADS DEVIATION` | — | Few rules; do not invent search |
| Rules List | @expo/ui Switch | RN Switch + Enable Alert | `INTENTIONAL INTELIADS DEVIATION` | — | Migration has no safety benefit |
| Rule Builder | 44pt controls | Chips / remove / add / delete / CTA | `FIX` | P1 | `minHeight` `layout.minTap`; PrimaryButton ~50pt |
| Rule Builder | Units explicit | Bare `30` could be % / $ / count | `FIX` | P1 | Suffix + a11y “ACoS threshold, percent”; Review uses `formatCondition` / `formatAction` |
| Rule Builder | Edit vs create | Same route; params change left create defaults | `FIX` | P1 | Rehydrate when `id` / `rule` change; missing `rule` is empty, not create |
| Rule Builder | Create is activation | CTA must not imply live automation | `COMPLIANT` | — | `Create rule (off)`; Nest `enabled: false` unchanged |
| Rule Builder | Search / SwiftUI form | Chip selectors, RN TextInput | `INTENTIONAL INTELIADS DEVIATION` | — | `@expo/ui` Host historically intercepts inputs; do not migrate |
| Rule Builder | Unsaved Back | Silent discard | `FOLLOW-UP` | P2 | D28 — do not invent draft persistence |
| Execution Detail | Audit first, mutations second | Revert/Reapply were the first viewport | `FIX` | P1 | Existing Amazon writes kept; moved below the record with warning copy |
| Execution Detail | Status text + tone | Completed-with-zero looked like a green success hero | `FIX` | P1 | Completed / Failed / Partial / No changes are labeled separately |
| Execution Detail | Combined labels | Rows unlabeled; raw ISO possible | `FIX` | P1 | Row label is name + type + result + before/after; time is spoken absolute |
| Execution Detail | Search / filter | None | `INTENTIONAL INTELIADS DEVIATION` | — | One run; do not invent search |
| Execution Detail | Populated entity rows | No stored runs in QA | `FOLLOW-UP` | P2 | D32 — do not run a Rule to generate history |

---

## Completed workstreams — lightweight Apple pass

| Screen | Classification |
| ------ | -------------- |
| Targets List | `ACCEPTABLE PRODUCT-SPECIFIC DEVIATION` (top filters, sheet for secondary) |
| Targeting Detail | `COMPLIANT` (hierarchy, labels, no new classification logic) |
| Campaigns List | `ACCEPTABLE PRODUCT-SPECIFIC DEVIATION` (top search); sort chip 44pt is `FIX` and device-verified (Spend + clear) |
| Campaign Detail | `COMPLIANT` |
| Ad Groups List | `COMPLIANT` after chip/Done/label fixes; search placement is intentional deviation |
| Ad Group Detail | `COMPLIANT` after this pass; campaign label “Campaign” until `campaign_name` exists |
| Books List | `COMPLIANT` after this pass; top search is the same intentional deviation as other lists |
| Book Detail | `COMPLIANT` after this pass; format/edition is a data gap |
| Search Terms List | `COMPLIANT` after this pass; top search + sort sheet match Campaigns; empty catalog is a data gap |
| Rules List | `COMPLIANT` after this pass; Enable confirm kept; empty catalog is a data gap |
| Rule Builder | `COMPLIANT` after this pass; chip pickers are an intentional Host/input deviation |
| Rule Execution Detail | `COMPLIANT` after this pass; Revert/Reapply remain existing product behavior, demoted |
| More Root | `COMPLIANT` after this pass; `@expo/ui` List not adopted; `(tabs)` back title remains D3 |
| Amazon Accounts | `COMPLIANT` after this pass; RN Switch kept (view-as lock + confirm); `@expo/ui` Switch not migrated |
| Bid bot | `COMPLIANT` after this pass; RN Alert kept for mutation confirms; SwiftUI segmented stays |
| My Account | `COMPLIANT` after this pass; metadata uncertainty and web-only billing are explicit |
| Negatives | `COMPLIANT` after this pass; dense read-only rows and current-state scope are explicit |

No completed screen was reopened for P2 polish.

| More Root | First viewport is a large account hero + mixed Manage list | Was email + “N profiles” over a 64pt banner, then Manage/Data/App with label-only rows | `FIX` — compact InteliAds identity; Automation / Data / App; truthful subtitles | P1 | Fixed 2026-08-22 More pass |
| More Root | Combined VoiceOver labels | Icon + title + chevron would chatter | `FIX` — `Bid bot. Recommendations and automation`; decorative icon/chevron hidden | P1 | Labels on live tree; VO not spoken |
| More Root | 44pt targets | Rows already `minHeight` 44; banner now 44 | `COMPLIANT` | P1 | Device PASS |
| More Root | Color not the only status | No status badges (none were trustworthy without new queries) | `COMPLIANT` | — | Keep |
| More Root | Reduce Motion | No row entrance stagger | `COMPLIANT` | — | Keep |
| More Root | Search in bottom toolbar | No search on a 12-row hub | `INTENTIONAL INTELIADS DEVIATION` | — | Keep |
| More Root | `@expo/ui` List | Native grouped Settings look already exists | `INTENTIONAL INTELIADS DEVIATION` | — | Keep `IOSGroupedSection`; no SwiftUI migration |
| More Root | Back title `(tabs)` | In-app More → child | `FOLLOW-UP` | P2 | D3 / D43 |
| More Root | `text_secondary` on white ~3.4:1 | Subtitles readable; fail WCAG AA 4.5:1 | `FOLLOW-UP` | P2 | D1 — theme token pass, not More-only |
| More Root | Data map label | Ambiguous; subtitle clarifies | `FOLLOW-UP` | P2 | D42 |

| Amazon Accounts | Enabled vs Connected | Switch was conflated with view selection and “active” | `FIX` — Enabled/Disabled text + switch; “In current view” is separate | P1 | Fixed 2026-08-22 Accounts UI |
| Amazon Accounts | View-as read-only | Mutations already locked; UI must say so compactly | `FIX` — compact banner; switches disabled; KDP hidden | P1 | Device PASS (populated view-as) |
| Amazon Accounts | 44pt switch / Unlink | Unlink was text + hitSlop 8 | `FIX` — 44pt switch well + Unlink hit | P1 | Code + populated rows |
| Amazon Accounts | Combined labels | Name-only row | `FIX` — name + marketplace + Enabled + view | P1 | Live tree |
| Amazon Accounts | Empty vs error | “No accounts connected” vs spinner | `FIX` — No Amazon profiles / profile Retry / KDP Retry | P1 | 16e empty + KDP error |
| Amazon Accounts | Disconnect | Missing on iOS | `INTENTIONAL INTELIADS DEVIATION` | — | Do not invent |
| Amazon Accounts | `@expo/ui` Switch | RN Switch + Alert confirm | `INTENTIONAL INTELIADS DEVIATION` | — | Host/input risk; confirm stays RN Alert |

| Bid bot | Snapshot vs live | `Current bid` would lie | `FIX` — “Bid when analyzed”; no `$` from selected profile | P1 | Fixed 2026-08-22 BidBot UI |
| Bid bot | Apply / placement confirm | None on safety audit | `FIX` — RN Alert names entity, snapshot → proposed, Amazon Ads consequence | P1 | Code + Cancel-only shots |
| Bid bot | Aggressive / Run-auto | Harmless CTA while auto-apply possible | `FIX` — Aggressive confirm; Run confirm when Careful/Aggressive | P1 | Code + Cancel-only shots |
| Bid bot | Selected-profile scope | Recs are account-wide | `FIX` — helper + About; no “Showing selected profiles” | P1 | Device PASS |
| Bid bot | View-as lock | Mutations already locked | `FIX` — compact banner; real Run Alert | P1 | `bidbot-viewas-lock.png` |
| Bid bot | Min/max as engine caps | GET `user_settings` ≠ BidBot save | `FIX` — display-only + caption | P1 | Settings light/dark |
| Bid bot | Confidence % | Bid score unused; placement is categorical | `COMPLIANT` — High/Medium/Low only; numeric/`92%` rejected | P1 | Tests |
| Bid bot | 44pt targets | Run / Apply / Save / Retry | `COMPLIANT` | P1 | PrimaryButton + inputs |
| Bid bot | Combined labels | Run said “Run engine” only | `FIX` — mode-aware Run label; rec VoiceOver uses analyzed/recommended | P1 | Live tree |
| Bid bot | Working tab name | Established action surface | `COMPLIANT` | — | Keep |
| Bid bot | `@expo/ui` Alert | RN Alert + existing segmented/buttons | `INTENTIONAL INTELIADS DEVIATION` | — | Host/input risk; confirm stays RN Alert |
| Bid bot | FlashList | Mixed Working sections | `INTENTIONAL INTELIADS DEVIATION` | — | ScrollView + memo rows; no FlashList in repo |
| Bid bot | Search in toolbar | None | `INTENTIONAL INTELIADS DEVIATION` | — | Operational screen |
| Bid bot | Populated rec rows | Pending GET failed this session | `FOLLOW-UP` | P2 | D50 — do not Run engine for screenshots |
| Bid bot | AXL crowding | Extreme Dynamic Type | `FOLLOW-UP` | P2 | D51 |
| Amazon Accounts | Search in toolbar | None | `INTENTIONAL INTELIADS DEVIATION` | — | Few profiles |
| Amazon Accounts | AXL email wrap | `test@gmail.co` / `m` | `FOLLOW-UP` | P2 | D44 |

| Sync | Amazon Ads-only status | “All data” / giant Records cards / loading=syncing | `FIX` — Ads hero, demoted window counts, checking ≠ syncing | P1 | Fixed 2026-08-22 Sync UI |
| Sync | First viewport | Action then hero then 3 metric cards | `FIX` — state + helper + Sync now / Cancel | P1 | Device PASS (16e + 17) |
| Sync | Cancel confirm | None; Cancel stops all pending parents | `FIX` — “Cancel current Amazon Ads sync?”; imported data stays | P1 | Code + unit test; not executed live |
| Sync | Selected ≠ enabled | Empty said “No account connected” | `FIX` — no-selected copy + scope helper | P1 | 16e empty + 17 helper |
| Sync | Per-profile freshness | One hero hid profile staleness | `FIX` — latest `profile_sync_logs` per profile | P1 | Code; this QA session had no PSL rows |
| Sync | Color not the only status | Icon + pill + text | `COMPLIANT` | — | Cancelled ≠ Failed |
| Sync | View-as lock | Mutations already locked | `FIX` — compact banner; no Sync now / Cancel | P1 | XXXL view-as + pending |
| Sync | 44pt targets | Sync now / Cancel / Retry / refresh | `COMPLIANT` | P1 | IOSButton 50pt; refresh `minTap` |
| Sync | Combined labels | Status unlabeled; refresh “Refresh sync” | `FIX` — Ads state + Sync now hint + refresh not-a-sync | P1 | Live tree |
| Sync | Fake progress | None in contract | `COMPLIANT` | — | Spinner only; no percent |
| Sync | `@expo/ui` Alert / Button | RN Alert + existing Primary/Secondary | `INTENTIONAL INTELIADS DEVIATION` | — | Host/input risk; confirm stays RN Alert |
| Sync | Expired token CTA | Guess from arbitrary errors | `FOLLOW-UP` | P1 | Only `invalid_grant` / refresh-token; SYN-P1-8 if no evidence |
| Sync | Customer session history | Hidden in view-as | `FOLLOW-UP` | P2 | SYN-P1-9 Nest `GET /sync-logs` unused |
| Sync | Search in toolbar | None | `INTENTIONAL INTELIADS DEVIATION` | — | Status screen |

| Settings | Unused min/max “guardrails” | `mobileSettings` had no Amazon/BidBot consumer | `FIX` — editors removed; Ads footer points to Bid bot | P1 | Settings light/dark/XXXL |
| Settings | Test alert as remote proof | Local `scheduleNotificationAsync` only | `FIX` — “Send a test on this iPhone”; body says not server push | P1 | Tests + live label |
| Settings | Appearance selector | Follows system; no theme write | `FIX` — value “Follows system”; role text; no chevron | P1 | Scrolled shot |
| Settings | KDP as a control | Static row | `FIX` — Profit source / KDP royalties + Chrome-helper footer | P1 | Scrolled shot |
| Settings | False “Settings saved” | Banner ignored remote save | `FIX` — banner and `mobileSettings` debounce removed | P1 | Code |
| Settings | View-as / guest | Self-scoped prefs | `FIX` — view-as note; guest disables alert switches | P1 | XXXL view-as note; guest code-only |
| Settings | 44pt targets | Switches / test / Bid bot | `COMPLIANT` | P1 | `settingsRow` minHeight 44 |
| Settings | Combined labels | Switch + value + unit | `FIX` — `New orders, on`; threshold includes percent + campaign budgets | P1 | Live tree |
| Settings | `@expo/ui` Switch / Slider / List | RN Switch + community Slider + `IOSGroupedSection` | `INTENTIONAL INTELIADS DEVIATION` | — | Host/input risk already observed |
| Settings | Long honesty footers | XXXL wraps | `FOLLOW-UP` | P2 | D54 |

| Auth login | First viewport | Marketing hero + missing recovery | `FIX` — 64pt mark, email/password, Sign in, Forgot, Create one, Preview demo | P1 | 16e + Auth QA |
| Auth login | Secure fields | Custom wrappers can break autofill | `FIX` — RN TextInput; username/password content types | P1 | Code |
| Auth login | Errors | Raw provider text / “Wrong password” | `FIX` — `humanizeAuthError`; network ≠ credentials | P1 | Error shot + tests |
| Auth signup | Invented password rules | Only 6 characters enforced | `FIX` — “Use at least 6 characters.” | P1 | Signup light/dark/XXXL |
| Auth forgot/reset | Implied in-app reset | Email finishes on web | `FIX` — web-finish copy; reset unauthenticated has no fields | P1 | Forgot + reset shots |
| Auth guest | Silent Continue | Preview demo + Amazon Ads won’t change | `FIX` | P1 | Login + guest Overview |
| Auth RouteGuard | Login flash / authed-on-auth | SplashGate waits on `loading`; authed → tabs | `COMPLIANT` | P1 | Bounce shot + tests |
| Auth Welcome | Ionicons | Mixed icon family | `FIX` — SF Symbols; Reduce Motion skips enter | P2 | Welcome small/standard |
| Auth | 44pt targets | Eye / Back / CTAs | `COMPLIANT` | P1 | AuthEye 44pt |
| Auth | Combined labels | Show/Hide password; Preview demo hint | `FIX` | P1 | Live tree |
| Auth | Sign in with Apple | Not on mobile | `INTENTIONAL INTELIADS DEVIATION` | — | Do not add a fake button |
| Auth | `@expo/ui` Host fields | Would intercept text input | `INTENTIONAL INTELIADS DEVIATION` | — | Same Host risk as BidBot |
| Auth splash | Dark canvas | Stays white | `FOLLOW-UP` | P2 | D58 |
| Auth legal | Terms / Privacy | None on mobile | `FOLLOW-UP` | P2 | D62 |

| My Account | Missing plan | Defaulted to green Pro badge | `FIX` — Unavailable; metadata-only source is named | P1 | Before/after + tests |
| My Account | Subscription status | Hardcoded Active | `FIX` — Unavailable; no green fallback | P1 | Light/dark/XXXL |
| My Account | Admin view-as | Customer-scoped profile data mixed with self identity | `FIX` — signed-in identity + explicit viewed-customer data section | P1 | Populated view-as device |
| My Account | Guest | Guest looked like Pro/Active account | `FIX` — Preview demo + Sign in/Create account; no subscription/profile ownership | P1 | Guest device |
| My Account | Billing | Conditional footer, no action | `FIX` — explicit web CTA to verified dashboard host | P1 | Browser handoff |
| My Account | Sign-out consequence | Generic “Are you sure?” | `FIX` — email + returns to Sign in; does not disconnect/delete | P1 | Native confirmation |
| My Account | Sign-out cleanup | Persisted query/view scope survived | `FIX` — guest, selected/view-as, Nest, memory + persisted cache cleanup | P1 | Tests |
| My Account | 44pt / Dynamic Type | Sign out + web/profile rows | `COMPLIANT` | P1 | 16e / dark / XXXL |
| My Account | `@expo/ui` List | Existing grouped primitives are stable | `INTENTIONAL INTELIADS DEVIATION` | — | No Host migration for aesthetics |
| My Account | Real destructive sign-out | Populated QA session preserved | `FOLLOW-UP` | P2 | Confirmation canceled; guest exit + cleanup code tested |

| Negatives | Row identity | One-line text + raw enum + red icon | `FIX` — wrapping identity, human type/scope/state, neutral blue/purple icon | P1 | 16e / standard / dark / XXXL |
| Negatives | Campaign/ad-group context | IDs existed but context was hidden | `FIX` — best-effort parent names + level; IDs remain hidden | P1 | Fixture rows + tests |
| Negatives | Admin view-as | Customer profile IDs went through self Supabase RLS | `FIX` — explicit unavailable state; no stale/false empty | P1 | View-as device |
| Negatives | Search | None | `FIX` — local identity/type/context/state search; shared field gets explicit label | P1 | Campaign-name search |
| Negatives | Error vs empty | Query failure rendered “No negatives” | `FIX` — RetryState / cached refresh warning / distinct empties | P1 | Code + tests |
| Negatives | Read-only semantics | Rows looked card-like but had no defined action | `COMPLIANT` — role text, no chevron, no delete/pause/create CTA | P1 | Live tree |
| Negatives | Performance | Inline rows in FlatList; no cap disclosure | `FIX` — memo primitive row, stable callbacks, latest-500 label/footer | P1 | Code + tests |
| Negatives | `@expo/ui` / FlashList | Native segmented already stable; FlatList already virtualized | `INTENTIONAL INTELIADS DEVIATION` | — | No migration/dependency |
| Negatives | Live production rows | Signed-in/customer data unavailable after QA session expiry/RLS | `FOLLOW-UP` | P2 | Populated device evidence is runtime-only fixture |

| Data coverage | P&L hierarchy | Net profit hero dominated a diagnostic | `FIX` — source cards replace profit/ACoS hero; no health score | P1 | Standard/small/dark/XXXL |
| Data coverage | Missing vs zero | Missing KDP displayed `$0` / negative net; 0 counts said Missing | `FIX` — null/unavailable money; empty Ads may be `$0`; optional 0 counts are None | P1 | Missing-state device + tests |
| Data coverage | Source semantics | Generic Ad Sales / Orders | `FIX` — Ad-attributed sales/orders vs KDP orders | P1 | Source cards |
| Data coverage | Error vs missing | One failed count blanked the screen | `FIX` — independent settled sources/counts + whole-screen fallback | P1 | Partial-error device |
| Data coverage | Admin view-as | Self Supabase data could appear under customer scope | `FIX` — explicit unavailable state; customer query disabled | P1 | View-as device |
| Data coverage | KDP boundary | Link/import could imply iPhone collection | `FIX` — Chrome helper imports; iPhone reads linked data | P1 | Light/dark/XXXL |
| Data coverage | Scope / date | Current counts mixed with selected period | `FIX` — context copy + separate Current setup / Selected period groups | P1 | Standard + bottom |
| Data coverage | Technical identifiers | Raw profile ID and table-like labels | `FIX` — profile name/marketplace only; user-facing labels | P1 | Profile scope device |
| Data coverage | VoiceOver grouping | Diagnostic card children read as fragments | `FIX` — grouped source summaries; combined count/profile rows; hidden decorative icons | P1 | Code; speech not run |
| Data coverage | Touch / Dynamic Type | CTA and long diagnostic copy | `COMPLIANT` — full-width buttons; wrapping source/status/copy | P1 | 16e / XXXL |
| Data coverage | `@expo/ui` / animation | Existing fixed diagnostic + native route/date controls | `INTENTIONAL INTELIADS DEVIATION` | — | No Host migration; no motion |
| Data coverage | Customer aggregate / KDP import time | No safe customer-scoped aggregate or import timestamp | `FOLLOW-UP` | P2 | Backend/source gap; UI does not invent |

| Rule activity | Execution vs Rule | Rows looked like one Rule = one history card | `FIX` — same Rule can appear many times; keys and nav use execution ID | P1 | Standard/small/dark/XXXL |
| Rule activity | Status collapse | Green check vs warning; failed+0 said No changes needed | `FIX` — shared `presentExecutionOutcome` / `executionStatusLabel` | P1 | All fixture statuses |
| Rule activity | Lifetime hero | 30-row window labeled Rules run / Changes made | `FIX` — Recent activity; cap copy at 30 | P1 | Header/footer |
| Rule activity | Admin view-as | Signed-in user's runs could appear under a customer | `FIX` — explicit unavailable; query disabled | P1 | View-as device |
| Rule activity | Error vs empty | Query failure used No activity yet | `FIX` — RetryState vs empty vs refresh warning | P1 | Code + tests |
| Rule activity | Historical rewrite | Current WHEN/THEN and harvest hints on history rows | `FIX` — omitted; entity-hint query removed | P1 | List vs Execution Detail |
| Rule activity | Dangerous actions | Revert/Reapply belong on detail | `COMPLIANT` — list is read + navigate only | P1 | List + detail shot |
| Rule activity | VoiceOver grouping | Name / status / counts / chevron as separate controls | `FIX` — one button; combined label; hidden chevron | P1 | Code; speech not run |
| Rule activity | Dynamic Type / 16e | Long names + status + time | `COMPLIANT` — wrap, no shrink | P1 | 16e / XXXL |
| Rule activity | `@expo/ui` / animation | No useful filter; no staggered history | `INTENTIONAL INTELIADS DEVIATION` | — | No Host migration; press opacity only |
| Rule activity | Current Rule name / TZ / 30-row cap | Join name, device-local time, recent window | `FOLLOW-UP` | P2 | D80–D82 |

UI/UX leftover work is closed. Notification infrastructure closed 2026-08-23 (`NOTIFICATION INFRASTRUCTURE: PASS`). Final release-wide regression closed 2026-08-23 (`FINAL RELEASE-WIDE REGRESSION: PASS` — `IOS_FINAL_RELEASE_REGRESSION.md`). Remote APNs stays BLOCKED BY DEPLOYMENT. Coverage map: `IOS_REMAINING_COVERAGE.md`.

| Surface | Check | Finding | Resolution | Severity | Evidence |
| ------- | ----- | ------- | ---------- | -------- | -------- |
| Notifications | Arbitrary `data.url` | Tap could `router.push` any string | `FIX` — event allowlist in `notificationContract.ts` | P1 | Tests + RouteGuard |
| Notifications | Cross-user token | Same-device login left prior user token | `FIX` — detach on sign-out/switch; payload `userId` | P0 | `clearNotificationIdentity` |
| Notifications | Remote proof | Token table ≠ sender | `FOLLOW-UP` — no Nest send | P2 | Audit: TOKEN REGISTRATION ONLY |
| Settings | Footer tap copy | Said Overview-only | `FIX` — Campaigns / Book / Settings | P2 | `settingsContract.ts` |

| Surface | Check | Finding | Resolution | Severity | Evidence |
| ------- | ----- | ------- | ---------- | -------- | -------- |
| Targets list | Combined VoiceOver row | Row children would chatter; pause/bid must stay independent | `FIX` — `targetingSpeech` on the navigating control only | P1 | Caption: `retirement gifts for men. Phrase keyword. High ACoS. Enabled.` Switch `keyword is active` independent |
| Targets list | Filters / sort | Icon-only filters | `FIX` — `Filters and sort` + chip clear labels + Done hint | P1 | Caption + live tree |
| Keyword / Target / Campaign / Ad group / Search-term detail | Identity + mutation speech | Header fragments; bare Switch / Add / Negate | `FIX` — grouped header; `Current bid` / `Edit budget`; named Add/Negate; Amazon-write hints | P1 | Live tree; Search Term fixture |
| Ad Groups list | Dark + populated | Empty Active; no dark shot | `FOLLOW-UP` closed with labeled runtime fixture | P2 data | `ad-groups-standard-dark.png` |
| Shared | Decorative ToneDot | Could take focus | `FIX` — hidden | P2 | `Primitives.tsx` + targeting-a11y tests |

---

## Simulator skill

`skills/ios/run-simulator/SKILL.md` wants scheme → simctl build → install → screenshot.

Adapted to Expo (do not prebuild):

- Used the existing native development build (`io.inteliads.app`) + Metro `--dev-client` on 8081.
- `frontend/ios` already contains `InteliAds.xcodeproj` / `.xcworkspace`.
- Primary walk: iPhone 17, iOS 26.5. Dark + Dynamic Type rendered on representative core screens.
- iPhone 16e and iPhone 17 Pro Max: launched without URL; populated core lists/details after QA token restore.
- Campaigns sort chip device PASS (Spend + clear, 44pt).
- Search Term Detail rendered (placeholder id + Dark).
- Reduce Motion, keyboard, scroll-restore driven on iPhone 17.
- VoiceOver: iOS 26 requires `launchctl kickstart system/com.apple.VoiceOverTouch`. Caption panel spoken. Features menu has no Toggle VoiceOver.
- Did not run `expo prebuild`.

Device results live in `IOS_DEVICE_QA.md`. Do not mark untested screens device verified.

---

## Nutrition Label / XCUITest

`accessibility-audit` automated audits and App Store Nutrition Labels are **not** claimed. Common tasks for a later pass: sign in, pick account, change date, scan a list, pause an entity, edit a bid/budget, open detail, go back.
