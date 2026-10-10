# iOS build 372 KDP helper evidence

Verified on the physical iPhone 14 Pro (`00008120-001210563E6BC01E`) on
2026-10-07.

## Verified

- Release guard: bundle `io.inteliads.app`, build 372, canonical release
  worktree.
- Release build installed in place and launched successfully.
- The KDP helper is presented as an autonomous **iPhone helper**; Chrome is
  optional.
- The saved KDP web session survives an in-place application install.
- The helper requires an explicit KDP import destination before it writes. It
  never infers Emilian Susanu, VPS 1, VPS 2, or Mary KDP from an Ads filter.
- The importer publishes an account/day only through the authenticated atomic
  `/kdp-sync/replace-day` endpoint.
- All royalties use the USD rollup; enabled marketplaces are replayed
  separately in native currency.
- A missing storefront response, rate limit, rejected acknowledgement, or
  suspicious zero/severe royalty regression leaves the accepted day unchanged
  and queued for retry.

## Live certification still requiring account owner input

No destination account was selected on this phone and Amazon currently shows
its sign-in page. A live KDP import was therefore deliberately not started.
Selecting the exact destination and completing Amazon sign-in are required to
certify a real 15-minute background import without risking cross-account data.

Apple schedules background refresh opportunistically. The helper requests the
15-minute cadence and catches up missed days, but iOS does not guarantee a wake
every 15 minutes while the app is suspended.

## Evidence

- `iphone14pro-launch.png`: installed build launch.
- `iphone14pro-helper-deeplink.png`: helper route before the final label update.
- `iphone14pro-helper-final.png`: installed final build showing the autonomous
  helper copy, preserved session, explicit account picker, and Amazon sign-in.
