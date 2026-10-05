# InteliAds iOS — Live UI Progress

Updated: 2026-08-23

This file must always answer:

1. What are we working on?
2. What is already completed?
3. What is still incomplete?
4. What is the next logical task?

---

CURRENT
Release branch + TestFlight upload

STATUS
Complete — `INTELIADS IOS TESTFLIGHT BUILD: UPLOADED` · `TESTFLIGHT PROCESSING: PENDING`

GATE
`INTELIADS IOS RELEASE CANDIDATE: READY`
`FINAL RELEASE-WIDE REGRESSION: PASS`
`NOTIFICATION INFRASTRUCTURE: PASS`

PRESERVED
`FINAL RELEASE-WIDE REGRESSION: PASS` · `NOTIFICATION INFRASTRUCTURE: PASS` · `DEVICE + ACCESSIBILITY CLOSURE: PASS` · prior UI/contract PASSes (unchanged)

LAST COMPLETED
`feat/ios-release-candidate` commits + Release archive + TestFlight upload of 1.0.0 (3). Main not merged. Branch not pushed.

THIS WORKSTREAM
Do **not** merge to main, submit App Store review, or implement remote APNs from this file.

MUST NOT
Redesign UI, implement remote APNs, or commit `.env` / metro-cache / skill trees.

---

DONE (carried forward)
[x] Final release-wide regression
[x] Release Candidate Readiness
[x] CREATE RELEASE BRANCH + COMMIT + TESTFLIGHT BUILD

REMAINING (ranked; next is first unchecked)
[ ] TESTFLIGHT DEVICE SMOKE after processing (`IOS_TESTFLIGHT_SMOKE_CHECKLIST.md`)

See `IOS_TESTFLIGHT_BUILD_REPORT.md`.

## Catalog identity and marketplace follow-up (2026-10-05)

This section tracks the current iOS Books/Ads/Target consistency work. It is
kept separate from the older release-candidate record above so its status is
not mistaken for a TestFlight submission.

COMPLETED

- [x] Resolve exact ASIN metadata (title, cover, stock, rating, review count)
  without copying values between editions.
- [x] Keep same-ASIN review and cover snapshots separate per marketplace;
  prefer the selected marketplace and expose the other snapshots.
- [x] Prefer the newer in-stock edition cover/title for the Books and detail
  headers while retaining the exact sponsored ASIN for campaigns.
- [x] Include all enabled USD marketplaces in a book detail so US/CA/UK
  campaigns for the same ASIN are not hidden by the selected profile.
- [x] Include enabled product ads whose ASIN is missing but whose SKU carries
  the sponsored ASIN, so Target book filters do not silently drop rows.
- [x] Add regression coverage for Nova Scotia old/new ASINs, Iceland cover
  refresh, same-ASIN marketplace review counts, and targeting identity.
- [x] TypeScript, full unit suite (1011 tests), Metro iOS export, and a debug
  device build/install on the connected iPhone 14 Pro passed.
- [x] Audit multi-market Ads money: Overview/Books/book-detail USD totals
  convert each marketplace's spend and sales with date-aligned market FX
  before aggregation and fail closed when a required rate is missing.
- [x] Keep Campaigns/Targets entity rows in their marketplace's native
  currency, including bids and budgets; fix Campaign and Ad Group details so
  CA/UK values cannot be mislabeled with the global USD chip.
- [x] Re-run TypeScript, focused lint, the money regression, and the complete
  1,011-test unit suite after the entity-currency fix.

OPEN

- [ ] Run the TestFlight smoke checklist on the uploaded build after Apple
  finishes processing; verify Books -> detail -> campaigns on the device.
- [ ] Build and device-smoke a new numbered iOS artifact containing the
  entity-currency fix before any TestFlight upload.
- [ ] Confirm live API rows for every enabled marketplace in the device smoke
  and record any missing stock/review/cover source row before release.
- [ ] Keep Chrome-extension KDP royalty correction work separate from this iOS
  branch; the levoppc incident remains an integrity guardrail, not a reason to
  rewrite historical totals from per-book data.
