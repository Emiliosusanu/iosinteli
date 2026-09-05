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
