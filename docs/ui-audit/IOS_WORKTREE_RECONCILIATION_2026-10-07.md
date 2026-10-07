# iOS canonical release line — 7 October 2026

## Canonical checkout

- Worktree: `/Users/emiliansusanu/Downloads/iosapp-inteli-wt-release-20261007`
- Branch: `codex/ios-merge-20261007`
- Certified starting point: commit `e14241ad`, external TestFlight build 369
- Bundle identifier: `io.inteliads.app`
- Connected certification device: iPhone 17 Pro Max, UDID `00008150-00124D4C02EA401C`
- Current candidate: build 371 (in-place installed over 370; the app was never uninstalled)

All new iOS edits, builds, archives and device installs must start in this worktree. Run
`frontend/scripts/assert-ios-release-line.sh` before a build. The command fails in every
unblessed worktree, on a branch that predates build 369, or when any app/widget/Xcode build
number is inconsistent.

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

Build 369 already includes the primary Bookshelf price capture and detailed print-setup
pricing gate. The release line now keeps report authentication separate from the pricing
step-up gate. A print-pricing sign-in redirect no longer erases the valid reports session in
Keychain, and cookie refreshes across the reports and KDP subdomains merge by cookie name.
Account switching and a proven reports-auth rejection still clear the session.

An in-place install with the same bundle id and Apple signing team preserves the app
container and Keychain. Certification installs must never uninstall the existing app.

## Verification checkpoint

- TypeScript: pass
- Unit suite: 1,015/1,015 pass
- Focused KDP session, pricing auth and Rule Activity tests: pass
- Release device compilation: pass with canonical local Pods and node modules
- Built artifact identity: `io.inteliads.app`, version `1.0.1`, build `371`
- Provisioning identity: team `AQ5FWX4K8Y`, application id `AQ5FWX4K8Y.io.inteliads.app`, existing Keychain group retained
- In-place installation on iPhone 17 Pro Max: pass; device reports installed build 371

The final launch/helper UI observation passed with the phone unlocked. Home showed the
authenticated portfolio after the update. KDP Helper showed Emilian Susanu selected,
KDP session **Signed in**, and report templates available. Its separate Paperback pricing row
correctly showed **Amazon login required** while the pricing step-up remained blocked; the
Reports session stayed signed in. Evidence is in `docs/qa/evidence/ios-build-371/`.
