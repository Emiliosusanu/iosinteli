# TestFlight 388 daytime readback — 2026-10-10

The physical iPhone 17 Pro Max remains on TestFlight 1.0.1 (388). Read-only evidence was collected through USB-C at approximately 20:06–20:12 Europe/Bucharest. The agent did not launch, reinstall, or update the app during collection.

## Observed results

- Latest recent-day report capture: 20:00:36 local (17:00:36 UTC), producer ios-1.0.1+388, both October 9 and 10 with 17 verified storefronts.
- October 9: $7.32, one order, 62 KENP. October 10: $0.03, zero orders, six KENP. Book royalties reconcile to those account totals. Zero orders alone is not treated as erased royalties.
- Last-90 coverage has 90 days, with at least 17 storefronts per coverage marker. This does not mean every historical marker was newly produced by 388 today.
- At 20:07:58 local, the automatic pricing pass completed 10 print books: 140 positive-price rows, 14 marketplaces, eight currencies, no incomplete positive-price rows and no break-even mismatches. Another 98 rows have null list prices and are excluded from the print-price completeness result; no zero prices were invented.
- Pricing transport errors at 13:31 local recovered at 14:15. Errors around 20:00 local were followed by fresh reports and then successful pricing.
- Native BGTask state records an expiration near 19:59:55 local. Its last successful TaskManager wake remains 11:53 local; successful report captures must not be misreported as successful completion of the native wake callback.
- The wake dispatcher remained active every 15 minutes. All 24 retained HTTP responses between 14:15 and 20:00 local reported 200, zero dispatch failures and four APNs-accepted sends each. APNs acceptance does not prove execution on this particular phone.
- The largest observed gap between completed recent-day captures was 179.38 minutes. The exact-15-minute continuous-background requirement fails this field observation.

The user reported carrying the phone with the helper left in background. There is a foreground event at 13:02 local, followed by interval/background-labelled ticks. Those labels alone do not independently prove the screen remained locked for the full afternoon.

At the start of the next confirmed locked-screen window (20:17 local), a fresh native-preferences read at 20:18 showed a successful TaskManager completion at 20:07:59 and no remaining native error. This occurred after the earlier native snapshot was collected; the initial expired-wake evidence above must not be read as a permanent failure.

## Release status

Report import, pricing recovery and current cloud reconciliation pass the readback. Continuous 15-minute execution is not certified. A genuine locked Amazon second-gate transition on physical 388 remains unobserved; this readback does not substitute for that test. Unrestricted mass-distribution certification remains open.

VPS1 1.2.160 and VPS2 1.2.159 are signed in with their original isolated account IDs; the read-only monitor reports no critical issues. Both retain slow-core warnings.

## Candidate correction

The physical evidence exposed a completion-state bug: a pricing transport exception could queue a retry but still publish Updated and advance the full-completion timestamp. Candidate 389 now keeps that state Retrying, preserves the successful report result, and advances full completion only after all report/pricing work finishes. Three behavioral regression tests cover transport failure, full success, pending pricing, authentication gate and report soft failure. This change is source-only; the phone remains on 388.

Machine-readable evidence: IOS_388_DAYTIME_BACKGROUND_READBACK_2026-10-10.json. No credentials, cookies or push tokens are included.
