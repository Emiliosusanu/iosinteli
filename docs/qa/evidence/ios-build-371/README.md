# iOS build 371 certification evidence

- Device: iPhone 17 Pro Max (`00008150-00124D4C02EA401C`)
- Bundle: `io.inteliads.app`
- Install: in-place over build 370; the app was not uninstalled.
- Commit: `011aa787bd301790f75a8c154d81d4cbdb04b300`
- Release build: `** BUILD SUCCEEDED **`

The Home capture shows the authenticated InteliAds portfolio and US, CA, UK and AU selection after the update. The KDP Helper capture shows the Emilian Susanu account selected, KDP session **Signed in**, and report templates available.

The helper also shows the independent paperback pricing gate: **Amazon login required**. This is expected when KDP's print-setup step-up is blocked. Reports remain signed in; the pricing step-up is isolated and can be completed once from the helper. The app keeps the existing InteliAds/KDP session across an in-place build update.
