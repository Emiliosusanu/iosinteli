# InteliAds anti-AI-slop visual audit

Classification: **GOOD** · **NEEDS REFINEMENT** · **AI-SLOP** · **GENERIC** · **INCONSISTENT**

Audit of the iOS product surfaces before and during the custom icon + Net
Royalties presentation pass. Code search covered `sparkle`, `wand`, `magic`,
`brain`, `robot`, `starburst`, `orb`, `assistant`, `hardware-chip`, and `cpu`.

---

## Definition used

AI-slop in this product means visual language that sells “artificial
intelligence” instead of advertising / publishing / money / control:

sparkles, wands, stars-as-AI, robot heads, brains, orbs, neural nets,
generic purple/blue AI gradients, glowing circles, excessive glass on
content cards, rainbow gradients, neon, magic icons, assistant avatars,
hexagon decoration, card-in-card-in-card, and icon-in-a-colored-blob as
the default.

InteliAds is a professional Amazon Ads + KDP control system.

---

## Codebase search (pre-fix)

| Pattern | Result |
| --- | --- |
| `sparkles` / `sparkles-outline` in screens | None. `Native.tsx` already mapped both to `slider.horizontal.3`. |
| `wand` / `magic` / `brain` / `robot` in TSX | None |
| Home BidBot | Was `hardware-chip-outline` + `tone="product"` purple blob (**AI-SLOP**) |
| More / Settings BidBot | SF `cpu` (**GENERIC** / AI-chip) |
| Welcome | “Profit by book” + 72pt icon bubble (**GENERIC**) |
| Home `CardTitle` | Every section title in a tinted rounded square (**GENERIC**) |
| Chart `LinearGradient` | Data fill under sparkline (**GOOD** — not chrome) |
| Tab bar `BlurView` | System tab chrome (**GOOD**) |
| `DynamicIsland.tsx` gradient | Live Activity chrome, not this workstream |

---

## Screen audit

### Home / Overview

| Element | Class | Notes |
| --- | --- | --- |
| Today / 7D Ads pulse | GOOD after fix | Labeled **Amazon Ads**. Spend / Ads orders / Ads sales / Ads ACoS. Not royalties. |
| Net Royalties hero | GOOD after fix | Label + caption + `—` when KDP or ads missing. Formula is royalties − spend. |
| Month / Week chrome | GOOD | Native segments, 16pt inset. |
| Account / sync chips | GOOD | System building + status dot. |
| Review queue | NEEDS REFINEMENT → GOOD | Removed tinted icon wells. Open attention/success marks. |
| Ads funnel / Campaigns / Budget / BidBot / Automation / Placement / Yesterday / Top books | GENERIC → GOOD | Open `InteliAdsIcon`, no colored chip. BidBot is a slider+target, not a bot. |
| Yesterday “Net” | INCONSISTENT → GOOD | Was a bare “Net” and could show `0 − spend` when royalties missing. Now “Net roy.” / `—`. |
| Nested cards | GOOD | One `DashboardSurface` per section. |
| Decorative sparkles | GOOD | None. |

### Campaigns list

| Element | Class | Notes |
| --- | --- | --- |
| Row metrics | GOOD | Spend / ACoS / orders. “Profitable” here is Ads vs break-even — left alone. |
| Empty megaphone | GENERIC | System empty illustration. Acceptable; not an AI glyph. |
| Filters / search | GOOD | Native search + segments. |

### Campaign Detail

| Element | Class | Notes |
| --- | --- | --- |
| Outcome / ACoS / budget | GOOD | Ads-domain. No publisher Net. |
| “Profitable” verdict | GOOD | Ads ACoS vs break-even. Not relabeled. |

### Targets / Target Detail

| Element | Class | Notes |
| --- | --- | --- |
| “Profit” filter | GOOD | Ads profitability filter. Not Net Royalties. |
| Crosshair-like locate SF | GENERIC | System locate. Tab now uses custom targeting brackets. |

### Books list

| Element | Class | Notes |
| --- | --- | --- |
| Sort “Profit” | INCONSISTENT → GOOD | Now “Net roy.” Same `net` key = royalties − spend. |
| Row caption “Profit” | INCONSISTENT → GOOD | Now `Net Royalties`. |
| Status “Profitable” | INCONSISTENT → GOOD | Now “Net positive” / “Net negative”. |
| Cover + typography | GOOD | Identity first; money second. |
| Empty cube | GENERIC → GOOD | Custom `books` mark. |

### Book Detail

| Element | Class | Notes |
| --- | --- | --- |
| Ambiguous “Profit” + “Sales” | INCONSISTENT → GOOD | Corner is Net Royalties. Strip is KDP royalties / Ads spend / Ads sales / Ads ACoS. Caption states the formula. |
| Campaign “Profitable” | GOOD | Ads-domain child rows. |

### BidBot

| Element | Class | Notes |
| --- | --- | --- |
| Empty `pricetag` | GENERIC → GOOD | Custom `bidBot` slider mark. |
| Copy | GOOD | Operational: recommendations, off, last run. No “AI is thinking”. |
| Icon language | AI-SLOP → GOOD | No robot, brain, sparkle, wand, orb, purple chip. |

### Rules / Rule Activity

| Element | Class | Notes |
| --- | --- | --- |
| More row `cpu` / purple | GENERIC → GOOD | BidBot slider; Rules branch SF; primary/inactive tones. |
| Empty states | GOOD | Short title + explanation. |

### Search Terms

| Element | Class | Notes |
| --- | --- | --- |
| List chrome | GOOD | Search + metrics. No AI decoration. |

### Sync / Accounts / Settings

| Element | Class | Notes |
| --- | --- | --- |
| Settings “Profit data / Profit source” | INCONSISTENT → GOOD | “KDP data” / “Royalty source”. Footer states Net Royalties contract and that it is not full P&L. |
| BidBot settings row `cpu` | GENERIC → GOOD | `slider.horizontal.3`. |
| Accounts | GOOD | Operational connection UI. |

### Notifications / sheets / filters / badges

| Element | Class | Notes |
| --- | --- | --- |
| System bell / calendar / chevron | GOOD | SF for system actions. |
| Status pills | GOOD | Text + color; color is not the only signal. |
| Metric widgets | GOOD after fix | Domain labeled (Ads vs KDP vs Combined). |

### Tabs / navigation

| Element | Class | Notes |
| --- | --- | --- |
| Overview / Campaigns / Targets / Books | GENERIC → GOOD | Custom family, selected = heavier stroke. |
| More | GOOD | System ellipsis. |
| Tab blur | GOOD | Native, not card glassmorphism. |

---

## Icon inventory

| OLD | LOCATION | MEANING | REPLACEMENT |
| --- | --- | --- | --- |
| `hardware-chip-outline` in purple blob | Home BidBot `CardTitle` | Bid optimization | `InteliAdsIcon` `bidBot` (slider + target), no blob |
| SF `cpu` | More → Bid bot, Settings → Bid bot | Same | `slider.horizontal.3` |
| `pricetag-outline` | BidBot empty recs | No recommendations | `productIcon="bidBot"` |
| SF grid / megaphone / location / book | Tab bar | Product tabs | `overview` / `campaigns` / `targeting` / `books` |
| `flash-outline` bolt blob | Home Automation | Rules activity | `automation` open mark |
| `book-outline` green blob | Home Top books | Books | `books` |
| `megaphone-outline` blob | Home Campaigns | Campaigns | `campaigns` |
| `wallet-outline` blob | Home Budget | Spend pace | `adSpend` |
| `cube-outline` | Books empty | No books | `books` |
| `business-outline` | Home no account | No Amazon link | `amazonAccounts` |
| Welcome creditcard in bubble | Welcome | “Profit by book” | Open `netRoyalties` + contract copy |
| `sparkles` ionicon if leftover | `Native.tsx` map | Was AI sparkle | Still remapped to `slider.horizontal.3` |
| `hardware-chip-outline` leftover map | `Native.tsx` | AI chip | Remapped to `slider.horizontal.3` |

Unchanged on purpose: campaign/target **Profitable** verdicts and the Targeting
**Profit** filter (Ads-domain). Chart area fills. System chevrons.

---

## Remaining non-blockers

| Item | Class | Why it stays |
| --- | --- | --- |
| `tone_product` purple token | NEEDS REFINEMENT | Still used for product-target vs keyword distinction. Not BidBot. |
| Campaign `net = sales - spend` | GOOD | Ads-attributed, documented, not shown as publisher Net Royalties. |
| Ads-only book fallback royalties `0` | NEEDS REFINEMENT | Pre-existing extraction when no KDP daily rows. Not changed this pass. |
| List empty SF illustrations | GENERIC | Functional. Product-owned empties were replaced first. |
| Physical identity | — | Not certified until iPhone 17 review. |

---

## Personality target

Publishing intelligence without AI cliché. Advertising control. Financial
precision. Calm, editorial, premium utility.
