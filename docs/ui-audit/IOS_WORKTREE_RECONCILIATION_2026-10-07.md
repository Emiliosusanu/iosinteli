# iOS canonical release line — 7 October 2026

## Canonical checkout

- Worktree: `/Users/emiliansusanu/Downloads/iosapp-inteli-wt-release-20261007`
- Branch: `codex/ios-merge-20261007`
- Certified starting point: commit `e14241ad`, external TestFlight build 369
- Bundle identifier: `io.inteliads.app`
- Connected certification devices: iPhone 17 Pro Max, UDID
  `00008150-00124D4C02EA401C`, and iPhone 14 Pro, UDID
  `00008120-001210563E6BC01E`
- Current candidate: build 372 (installed in place on iPhone 14 Pro; the app was
  never uninstalled)

All new iOS edits, builds, archives and device installs must start in this worktree. Run
`frontend/scripts/assert-ios-release-line.sh` before a build. The command fails in every
unblessed worktree, on a branch that predates build 369, or when any app/widget/Xcode build
number is inconsistent.

`origin/main` is not the current release line. On 7 October it diverged by 218
release commits and merging it into this worktree would remove recent iOS features. The
review base is `origin/feat/ios-release-candidate`; PR #108 contains the 12 release commits
after that base. Do not rebase build 372 onto `origin/main` or build from another checkout.

## Preservation and reconciliation

No worktree was deleted or reset. All 29 worktrees were inventoried. Nineteen dirty
worktrees were preserved as binary product-code patches and untracked-file archives at:

`/Users/emiliansusanu/Downloads/iosapp-inteli-safety-all-20261007`

Generated caches and secret environment files were not copied into the archive. They remain
in their original worktrees and are listed in each snapshot directory. This avoids moving
credentials while keeping every source, test and document change recoverable.

The old worktrees predate build 369. Their complete dirty states must not be merged over the
release line because doing so reverts marketplace identity, FX, catalog reconciliation and
native build changes. The one coherent edit bundle made after build 369 was the 6 October
Rule Activity correction; it has been moved onto this canonical line with its test.

Three older branches contain commits not present by ancestry (`codex/cursor-328-snapshot`,
`codex/owned-daily-metrics-20260924`, and `feat/smart-order-notifications`). Their work is
preserved in Git and in the safety inventory. They are quarantined for semantic comparison,
not blind cherry-picking, because build 369 contains later implementations in the same files.

## KDP helper session and pricing gate

Build 372 includes the primary Bookshelf price capture and detailed print-setup
pricing gate. The release line now keeps report authentication separate from the pricing
step-up gate. A print-pricing sign-in redirect no longer erases the valid reports session in
Keychain, and cookie refreshes across the reports and KDP subdomains merge by cookie name.
Account switching and a proven reports-auth rejection still clear the session.

The iPhone helper is an autonomous source; Chrome is optional. The account-wide rollup is
captured in USD, enabled marketplaces are replayed separately in native currency, and all
day tables are accepted through the authenticated atomic replace-day endpoint. Missing
storefronts, rate limits, acknowledgement mismatches and suspicious zero/severe royalty
regressions preserve the prior accepted day and leave it queued for retry.

An in-place install with the same bundle id and Apple signing team preserves the app
container and Keychain. Certification installs must never uninstall the existing app.

## Verification checkpoint

- TypeScript: pass
- Unit suite: 1,022/1,022 pass
- Focused KDP session, pricing auth and Rule Activity tests: pass
- Release device compilation: pass with canonical local Pods and node modules
- Built artifact identity: `io.inteliads.app`, version `1.0.1`, build `372`
- Provisioning identity: team `AQ5FWX4K8Y`, application id `AQ5FWX4K8Y.io.inteliads.app`, existing Keychain group retained
- In-place installation and launch on iPhone 14 Pro: pass; device reports installed build
  372

The final launch/helper UI observation passed with the iPhone 14 Pro unlocked. KDP Helper
shows the four isolated destinations and refuses to infer one from an Ads filter. Its saved
KDP session survived the in-place install, but no destination is selected and Amazon shows
the sign-in page. A live import was deliberately not started until the exact destination is
selected. Evidence is in `frontend/docs/qa/evidence/ios-build-372/`; the prior build 371
evidence remains in `docs/qa/evidence/ios-build-371/`.
