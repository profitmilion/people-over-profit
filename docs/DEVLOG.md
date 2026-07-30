# POP33 DEVLOG

The DEVLOG is a concise, chronological record of important POP33 sessions,
milestones, and technical decisions. It also preserves confirmed source
material for future content about project development, technical insights, and
work shared while “building in public.”

Unlike `STATUS.md`, which provides a current overview of implementation,
gaps, and risks, the DEVLOG records the significance of selected completed
stages over time. It is not a complete commit history, a backlog, or a finished
marketing channel.

Add a new entry after completing a significant, verifiable stage or approving
a technical decision that affects the product, architecture, or security. The
communication section is only for recording careful ideas for future content;
it must not turn stage limitations into promises or present a finished post.
Technical information must be confirmed by Git, test results, or current
documentation.

## DEVLOG maintenance rules

- Keep entries in chronological order, with the newest confirmed entry first.
- Record only significant completed stages and approved decisions; omit minor
  fixes and unconfirmed plans.
- Use the standard entry structure and clearly separate completed work,
  verification, limitations, and the next logical step.
- In the `Git` section, include the branch, full commit hash, and exact commit
  message.
- Distinguish local execution, testnet, and mainnet, and explicitly state
  whether public transactions or a deployment occurred.
- Do not present local simulation or tests as evidence of production readiness.
- Do not duplicate the full project state from `STATUS.md`; refer to it for the
  current overview of implementation, gaps, and risks.
- Do not guess. Mark unclear facts as requiring later reconstruction.

## 2026-07-30 - Read-only multi-pool lifecycle supervisor

### At a glance

POP33 now has a deterministic, fixture-backed operator view that assigns one
next lifecycle action to every observed pool without loading a key or
submitting a transaction.

### Completed

- Added a pure snapshot-to-plan engine for Open, Locked, Drawing, Claimable,
  Finished, and inconsistent states.
- Added explicit due/overdue timing with a documented 900-second default
  threshold and one-round-only handling when several schedules elapsed.
- Added lifecycle, round sequence, unique-winner, Claim, exact accounting,
  escrow, missing-data, and unknown-status diagnostics.
- Added deterministic SHA-256 plan IDs bound to source, chain, contract,
  block, time, pool snapshot, action, and proposed round.
- Added a fixture-only read adapter and CLI with text, JSON, pool,
  actionable-only, and warning-only output.
- Added `docs/LIFECYCLE_SUPERVISOR.md`.

### Verification

- Focused supervisor test: passed, `30/30`, using deterministic local fixtures
  only.
- Combined supervisor and existing read-only retry tests: passed, `37/37`.
- Contract TypeScript and compilation: passed.
- Frontend domain regression: passed, `29/29`; frontend build: passed.
- Focused ESLint for every new runtime and test file: passed. Full repository
  ESLint retains only the nine pre-existing exact-99 unused-variable errors.
- `git diff --check`: passed.
- The human and JSON CLI forms were exercised against `multi-pool`.
- No RPC, wallet, transaction, deployment, smart-contract change, ABI change,
  route change, or public frontend change occurred.

### Limitations and next step

- The new adapter boundary currently has only a fixture implementation.
- It does not complete public exact-99, execute Draw, or automate payouts.
- The next logical task is a separately reviewed Base Sepolia public-read
  adapter for the existing snapshot interface.

### Git

- Branch: `codex/pop33-lifecycle-supervisor`.
- Source baseline:
  `01437927f9ae40b726ec39edafe9b6d57ed7b3a6`.
- Commit: not created at the time this entry was written.
- Proposed message: `feat(operator): add read-only lifecycle supervisor`.

## 2026-07-29 - Mobile-first Demo V1 preparation flow

### At a glance

Demo V1 now leads a first-time mobile tester through wallet, Base Sepolia,
test ETH, dUSDC, exact approval, and Join readiness with one dominant next
action.

### Completed

- Added a visible readiness checklist for wallet, chain `84532`, recommended
  test ETH, at least 33 dUSDC, exact allowance, and Join readiness.
- Added explicit missing-provider guidance for opening the page in MetaMask or
  another compatible wallet's built-in browser, without adding WalletConnect
  or a dependency.
- Made the official Base faucet list the primary test-ETH source and explained
  that both ETH and dUSDC are valueless test assets with different purposes.
- Split exact 33 dUSDC approval and Join into two separately confirmed user
  actions.
- Added concrete states for rejected wallet requests, switching or adding the
  network, low balances, faucet cooldown, unsafe allowance, busy transactions,
  and full readiness.
- Reduced mobile page padding and made the primary preparation action full
  width with a minimum 44-pixel height.

### Verification

- `npm test`: passed, `29/29`, using local domain fixtures only.
- `npm run build`: passed.
- ESLint on all changed TypeScript/TSX files: passed.
- Full `npm run lint`: stopped only on the nine pre-existing exact-99 unused
  variable errors; no operator files were changed.
- No faucet, approve, join, withdrawal, draw, claim, operator run, deployment,
  contract change, wallet creation, commit, or push occurred.

### Limitations and next step

- The change has not yet been deployed, so the existing public Preview does not
  yet expose the new flow.
- Demo and Archive tables were intentionally not redesigned. A real phone pass
  at 320, 375, and 390 pixels remains the next Preview verification.
- WalletConnect remains outside this stage and requires a separate dependency
  and security review.

### Git

- Branch: `codex/pop33-recovery`.
- Source baseline:
  `e41cfd0f8230b367fe646bf39ece2b58d71ed448`.
- Commit: not created; the worktree is intentionally awaiting Piotr's review.
- Proposed message: `feat(demo-v1): add guided mobile onboarding`.

## 2026-07-27 - Demo V1 frontend supports the locking 100th join

### At a glance

The public Demo V1 frontend no longer stops at the historical reversible-test
boundary. It now supports Open pools through `99/100` and verifies the 100th
join as the contract transition to `Locked`, including exact escrow,
`lockedAt`, and the first draw schedule.

### Completed

- Removed the frontend-only 89-position preflight cap without changing the
  smart contract, ABI, addresses, approve amount, or transaction sequence.
- Strengthened join preflight with exact pool escrow, capacity, lock-state, and
  per-pool membership checks in addition to the existing chain, runtime
  identity, token balance, allowance, active-position limit, and gas checks.
- Bound post-receipt verification to the actual `PositionJoined` event,
  position, and pool selected by `join()`, including the case where another
  qualifying pool is selected between preflight and mining.
- Required joins ending at 1-99 to remain Open with zero `lockedAt`; required
  the 100th join to end at exactly 100 positions, 3,300 dUSDC escrow, `Locked`,
  non-zero `lockedAt`, and ten valid pending-round schedules.
- Updated the public UI with live pool fill, a specific 99/100 locking warning,
  locked time, first draw time, and explicit withdrawal unavailability after
  lock.
- Added fixture-only coverage for 89, 90, 98, 99, `100 Locked`, allocation
  races, inconsistent receipt/state, and refresh after confirmed verification.

### Verification

- `npx tsc --noEmit`: passed during implementation.
- `npm test`: passed, `25/25`; all tests use local fixtures and mocks without
  external RPC or transactions.
- Final build, scoped ESLint, UI fixture rendering, and Git checks are recorded
  in the pre-commit report for this worktree.
- No faucet, approval, join, withdrawal, draw, claim, deployment, or other
  public transaction occurred.

### Limitations and next step

- The frontend capability is locally verified, but a complete public
  `100 positions -> Locked -> ten draws -> ten claims -> Finished` lifecycle has
  not yet been executed.
- Draw and claim still lack the detailed semantic post-receipt reconciliation
  now used by faucet, join, and withdrawal. That verification should be the next
  reviewed product task before a public full-lifecycle execution.
- Multi-pool presentation remains getter-based and intentionally bounded; it
  was not expanded in this stage.

### Git

- Branch: `codex/pop33-recovery`.
- Source baseline:
  `96afb8faca4df51a9dae1257503fba722c4a19b6`.
- Commit: not created; the worktree is intentionally awaiting Piotr's review.
- Proposed message: `fix(demo-v1): support the locking 100th join`.

## 2026-07-27 - Demo V1 established as the sole public product flow

### At a glance

The public frontend now presents one current POP33 product path:
`landing -> #/demo-v1 -> #/archive-v1`. The preserved old contract integration,
browser-local simulator, and local archive remain in the repository as clearly
labelled legacy/DEV layers and are no longer alternative public product flows.

### Completed

- Changed ordinary `#/demo` into a legacy notice with a link to the current
  Demo V1 and removed its old-contract wallet action from the rendered route.
- Preserved the browser-local simulator at `#/demo?view=dev` while stating that
  it may use `localStorage`, does not use the current contract, and does not
  represent current Demo V1 economics or its full lifecycle.
- Kept `#/archive-v1` as the public on-chain archive and strengthened the
  non-production labelling of the preserved browser-local `#/archive`.
- Removed the public `Legacy demo` link from Demo V1.
- Rewrote the landing around the deployed Base Sepolia facts: valueless dUSDC,
  33 dUSDC per position, 100 positions, ten 330 dUSDC rounds, an hourly test
  schedule, test-only randomness, and no real prizes.
- Separated future Mainnet, production-randomness, automation, and scale ideas
  from current Demo V1 functionality.
- Corrected the local simulator's historical profile so it no longer claims an
  on-chain position or active subscription.

### Verification

- `npx tsc --noEmit`: passed.
- `npm test`: passed, `20/20`.
- `npm run build`: passed; only existing dependency-annotation and bundle-size
  warnings were reported.
- Scoped ESLint over all changed frontend files: passed.
- Local headless-Chrome smoke checks passed for `#/`, `#/demo-v1`,
  `#/archive-v1`, `#/demo`, `#/demo?view=dev`, and `#/archive`.
- The local Vite server was stopped after verification; port `4174` had zero
  listeners.
- No wallet was connected and no faucet, approval, join, withdrawal, draw,
  claim, deployment, or other public transaction occurred.

### Limitations and next step

- This stage deliberately did not change the reversible 90/100 frontend
  boundary, the 100th join, multi-pool UX, draw/claim behavior, the on-chain
  archive, contracts, Vercel, or exact-99.
- The contract/operator suite was not rerun because no contract or operator
  file changed; the incoming checkpoint's confirmed result remains `397/397`.
- The next separately reviewed product stage should address the most important
  remaining public lifecycle blocker without weakening the locked-pool safety
  boundary.

### Git

- Branch: `codex/pop33-recovery`.
- Source baseline:
  `211d7d9e06850746bbd6c347252a55a225f36a9d`.
- Commit: not created in this session; the worktree is intentionally awaiting
  review.
- Proposed message:
  `refactor(frontend): make Demo V1 the sole public product flow`.

## 2026-07-27 - Public execution protocol and journal v2 specified fixture-only

### At a glance

The exact-99 path now has an executable local specification for durable
transaction identity, nonce/fee controls, finality, reorg recovery, a global
run lock and the high-risk 99th-position boundary. No network execution path
was added.

### Completed

- Added the ordered 23-step one-operation protocol.
- Added a checksummed append-only journal v2 with one nonce and signed hash per
  attempt, explicit replacement links, complete receipt identity, canonical
  rechecks and forward-only states.
- Added fixture nonce, fee-cap, global-lock, dual-source evidence, finality and
  recovery models.
- Split future public accumulation into normal indices `0-97` and the separate
  one-use `boundary-99` mode for index `98`; index `99` remains rejected.
- Added requested crash-window, concurrency, corruption, replacement,
  cancellation, reorg and external-join fault tests.
- Added a fixture-only per-wallet encrypted store v2 prototype and a decision
  recommending this isolation model after production-strength review.
- Preserved the existing journal v1, cumulative coordinator, runner and pilot.

### Verification

- Focused new suite: 65 local fixture tests.
- Full package verification: TypeScript passed, Hardhat compile passed, and
  all `397/397` tests passed.
- The source contains no provider, signer, endpoint, environment-secret read or
  transaction transport.

### Limitations

- The global lock and public protocol are fixture models, not durable
  cross-process/public adapters.
- Final confirmation depths and real fee limits remain `TO DECIDE`.
- Store v2 uses an intentionally fixture-labelled low-cost KDF profile and must
  not hold real wallet material.
- No real exact-99 artifact, wallet, signer or transaction was created.

### Next logical step

Independently review and Git-checkpoint this fixture-only protocol. Do not
implement a public adapter or create the real store without a separate prompt.

### Git

- Branch: `codex/pop33-recovery`
- Commit: pending separate approval
- Message proposal:
  `feat(operator): specify exact-99 public execution protocol`

## 2026-07-27 - Exact-99 cumulative execution runner core prepared fixture-only

### At a glance

A realistic local runner core now joins the exact-99 artifacts, funding plan,
coordinator, injected operation adapter, receipt evidence, and semantic state
reconciliation without adding a Base Sepolia connection.

### Completed

- Added manifest-bound plan, inspection, single-step simulation, and cumulative
  range simulation.
- Added a narrow injected fixture adapter for funding, faucet, approve, and
  join.
- Enforced one-wallet-at-a-time operation order and checkpoint authorization.
- Added funding, faucet, approval, and join-specific semantic reconciliation.
- Added before/after pool snapshots for participant-count, cycle, lock, and
  `lockedAt` race detection.
- Preserved operation IDs, hashes, append-only history, restart behavior, and
  stop-on-first-error through the existing coordinator and journal.
- Added stronger removal of secret-shaped values and field names from adapter
  errors.
- Kept index 99 and the manual 100th join outside the runner.
- Added a dedicated runner runbook.

### Pilot audit

The runner reuses the pilot's safety principles and shared sanitizer/recovery
model. Pilot-only Ethers runtime, RPC, nonce, signer, pool #1, wallet indices
0/1, and withdrawal behavior were not copied.

### Verification

- Focused execution-runner suite: 34 local fixture tests.
- Full package verification is recorded in the pre-commit task report.
- No public RPC, provider, signer, key loading, or transaction transport exists
  in the new runner source.

### Limitations

- Only an injected fixture adapter exists.
- Public nonce management, gas policy, receipt reads, and chain reconciliation
  remain future adapter work.
- The runner does not create or open real exact-99 artifacts.

### Next logical step

Independently review and checkpoint this fixture-only runner. Do not begin a
public Base Sepolia adapter without a separate design, threat review, and
authorization.

### Git

- Branch: `codex/pop33-recovery`
- Commit: pending separate approval
- Message proposal: `feat(operator): add exact-99 execution runner core`

## 2026-07-27 - Exact-99 cumulative accumulation coordinator prepared fixture-only

### At a glance

A local coordinator now proves the future 99-wallet process can advance through
four separately authorized checkpoints while preserving one ordered,
append-only recovery history. No public RPC or transaction path was added.

### Completed

- Fixed the new-wallet ranges at `0-4`, `5-19`, `20-49`, and `50-98`.
- Added exact fixture authorization phrases for cumulative checkpoints 5, 20,
  50, and 99.
- Enforced one-wallet-at-a-time `funding -> faucet -> approve -> join` order.
- Bound fixture journal events to the checkpoint range, wallet-order digest,
  funding-plan ID, operation identity, and public wallet identity.
- Added forward-only running checkpoint stages for honest partial-range state.
- Added stop-on-first-error behavior for failed, pending, ambiguous,
  inconsistent-receipt, and manual-review outcomes.
- Added restart behavior that skips confirmed work and resumes a partial wallet
  at its first unfinished operation.
- Enforced the hard stop after index 98 and the transition to
  `awaiting-manual-100`.
- Added a dedicated coordinator runbook.

### Verification

- Focused coordinator suite: 26 local fixture tests.
- Full package TypeScript, compilation, and test results are recorded in the
  pre-commit task report.
- Source inspection confirms no provider, signer, environment-key loading,
  transaction transport, or public runner.

### Limitations

- The coordinator is an in-memory fixture planner, inspector, and simulator.
- It does not materialize real artifacts or reconcile uncertain public-chain
  transaction evidence.
- It does not authorize or implement funding, faucet, approval, join, manual
  100, draw, or claim activity.

### Next logical step

Independently review the coordinator diff and create a Git checkpoint only
after Piotr's separate approval. Real artifact initialization and every public
network action remain later, separately gated tasks.

### Git

- Branch: `codex/pop33-recovery`
- Commit: pending separate approval
- Message proposal:
  `feat(operator): add exact-99 accumulation coordinator`

## 2026-07-27 - Capped exact-99 funding subsystem prepared fixture-only

### At a glance

A deterministic local funding plan, inspection, and simulator now prove the
future 99 operator recipients can be constrained to the exact manifest,
per-wallet and total budgets, and a public funding-signer identity with a
required reserve. No ETH was sent and no public execution path was added.

### Completed

- Bound all 99 indexed recipients and deterministic operation IDs to the
  existing set/store IDs, manifest fingerprint, and ordered-address digest.
- Required canonical decimal wei strings and rejected zero, negative,
  unit-labelled, per-wallet-over-limit, total-over-budget, insufficient-balance,
  and reserve-violating inputs.
- Added public fixture signer identity checks for address, chain, purpose,
  maximum budget, starting balance, and reserve without any credential.
- Extended the shared append-only journal with `planned` and terminal
  `skipped-already-funded` states while retaining forward-only transitions,
  immutable transaction hashes, stop-on-first-error, and recovery blockers.
- Added local success, failure, timeout, ambiguous, manual-review,
  already-funded, and restart simulation.
- Integrated funding-plan and confirmed-count reconciliation into the exact-99
  local preflight.

### Verification boundary

The focused funding suite passed 26 tests. The complete contract/operator suite
passed all 272 tests, and contracts TypeScript checking, contract compilation,
and `git diff --check` passed. All addresses, balances, hashes, receipts, and
outcomes were synthetic fixtures. The illustrative funding values are test
inputs, not approved operating constants. The module contains no provider,
private key, mnemonic, environment-secret access, transaction transport, or
public execution mode.

### Limitations and next step

There is no real funding-plan file or live gas input, signer, public RPC
preflight, or transfer runner. After independent review and a Git checkpoint,
the next engineering task is the fixture-only cumulative accumulation
coordinator for `5 -> 20 -> 50 -> 99`.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `76901794cee282c794ee8c3bed5cf86d8fac23b0`
- Commit: pending Piotr's explicit approval
- Proposed message: `feat(operator): add capped exact-99 funding plan`

## 2026-07-27 - Exact-99 artifact identity and recovery foundation prepared

### At a glance

A fixture-only artifact profile now organizes the future exact-99 participant
set around one manifest, lifecycle checkpoint, append-only journal, and local
redacted preflight. It preserves the approved
`5 -> 20 -> 50 -> 99 -> manual 100 -> 10 draws -> 10 claims` plan and keeps
the completed five-wallet pilot profile compatible.

### Completed

- Added a closed manifest schema binding the Base Sepolia deployment, purpose,
  set/store IDs, exactly 99 ordered public addresses, order digest, encrypted
  store fingerprint, creation time, fixed file identities, and hard stop 99.
- Added lifecycle checkpoint stages from `initialized` through `finished`,
  including cumulative action counters, last confirmed operation, recovery
  flags, forward-only stage updates, and stale-writer detection.
- Added an append-only operation-event journal with safe forward status
  transitions and terminal-state protection.
- Added local exact-99 preflight checks for count, uniqueness, order, hashes,
  shared artifact identity, recovery blockers, and automatic-join hard stop.
- Added runtime-artifact patterns to the root `.gitignore`.
- Corrected stale statements that predated the successfully completed
  two-wallet Base Sepolia pilot.

### Verification boundary

Only deterministic public fixture addresses and temporary local JSON files
were used. The focused suite passed 17 tests before the full verification run.
The code contains no wallet generation, RPC provider, signer, transaction
transport, funding, faucet, approval, join, draw, or claim implementation.
Piotr's real 99-wallet store and artifact set were not created.

### Limitations and next step

The existing PowerShell exact-99 initializer still creates only the encrypted
store. Real artifact materialization, backup, network preflight, funding, and
all public lifecycle actions remain separate authorization boundaries. The
next engineering task after review and Git checkpoint is the fixture-only,
capped funding subsystem.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `49d3cfe90b8383299d9fa4a4df754c895106ee6e`
- Commit: pending Piotr's explicit approval
- Proposed message: `feat(operator): add exact-99 artifact preflight`

## 2026-07-19 - Exact-99 wallet-store initializer and inspector prepared

### At a glance

A separate future initializer and local read-only inspector are now prepared
for the 99 automatic participants in the planned Base Sepolia full-lifecycle
test. Only temporary fixture stores were created by tests. Piotr's real store
was not initialized, no wallet was funded, and no transaction was performed.

### Completed

- Reused the existing version 1 scrypt and AES-256-GCM encrypted wallet-store
  format without migrating or modifying the completed five-wallet pilot.
- Added a fixed, separate full-lifecycle file identity and a write-free dry-run
  that reports the planned location, exact count, target existence, and safety
  boundaries without generating wallet material.
- Added a create-only exact-99 initializer with exact confirmation, two hidden
  matching password entries, private temporary-file creation, authenticated
  reopen and validation before final rename, cleanup on failure, and overwrite
  refusal.
- Added a local read-only inspector limited to format/store metadata, public
  indices and addresses, encrypted-file SHA-256 fingerprint, duplicate and
  missing-address findings, exact-count status, and structural validation.
- Kept checkpoint, manifest, transaction journal, RPC, funding, faucet,
  lifecycle action, signer, and broadcast capabilities out of this narrow
  artifact stage.

### Verification boundary

The focused fixture-only suite passed 9 tests covering dry-run and import side
effects, exact count and confirmation, overwrite refusal, pilot isolation,
temporary-file cleanup, read-only byte preservation, missing and duplicate
addresses, output redaction, hidden prompts, and absence of RPC/signing/
transaction transport. All 229 contracts/operator tests passed. Contract
compilation, contracts and root TypeScript checks, root lint, all 20 frontend
domain tests, and the production build passed. The contracts production
dependency audit reported zero findings. The end-to-end dry-run left its
planned target absent and generated no wallet material.

No real operator path was used. The PowerShell `Initialize` mode was not run.
No real wallet, store, checkpoint, manifest, journal, funding, faucet,
approval, join, withdrawal, draw, claim, deployment, Vercel, Production, or
Farcaster action occurred.

### Limitations and next step

The store format does not retain a creation timestamp, so the inspector reports
that field as unavailable. A later operator manifest, checkpoint, journal,
funding subsystem, and lifecycle coordinator remain separate reviewed tasks.

The next safe step is independent review of this code and fixture evidence.
Only a later explicit authorization may run `Initialize`; that step must be
followed by local inspection and an independently validated encrypted backup,
then stop before funding.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `91f3c4557f207c8636d6af97e8d6d5cedc68012b`
- Starting message: `docs: record pilot and plan full lifecycle test`
- The milestone commit hash does not exist because no commit was requested.

## 2026-07-18 - Two-wallet Base Sepolia pilot verified and 99+1 lifecycle planned

### At a glance

The first guarded operator write pilot, using independent wallet indices 0 and
1, completed successfully on Base Sepolia. Eight existing public transactions
prove the intended reversible sequence for each wallet: faucet, exact approval,
join, and Open-pool withdrawal. This documentation session independently
checked their receipts and current public state and then defined a staged plan
for a separate full `99 automatic + 1 manual` lifecycle test. It did not send
another transaction.

### Completed

- Matched every pilot journal operation to a successful public receipt,
  sender, destination, nonce, calldata, expected event, and semantic result.
- Confirmed both wallets at nonce `4/4`, 330 dUSDC, zero allowance, zero active
  position, and zero claimable prize, with pool 1 Open at zero active positions
  and zero escrow. Their temporary positions were 5 and 6 and were withdrawn;
  the pilot did not approach the 100-position boundary.
- Confirmed that the manifest and encrypted five-wallet store retained their
  pre-pilot hashes. The checkpoint and journal changed as expected and contain
  no pending or manual-review operation.
- Audited the deployed lifecycle against contract source and tests: the 100th
  successful join atomically locks the pool; ten hourly testnet round times are
  initialized; draws are sequential and permissionless but do not execute
  automatically; winners are unique; and the tenth successful claim finishes
  the pool and releases all 100 active positions.
- Documented the recommended separate 99-wallet store, funding boundaries,
  transaction budget, staged `5 -> 20 -> 50 -> 99 -> manual 100 -> 10 draws ->
  10 claims` gates, stop conditions, architecture gaps, and small future tasks.

### Verification boundary

The pilot receipts were observed read-only through public Base Sepolia RPC.
The local encrypted store was not decrypted and no password, private key, seed
phrase, or funding credential was requested. No wallet was created or funded,
and no faucet, approval, join, withdrawal, draw, claim, deployment, Production,
Vercel, or Farcaster action was performed by this documentation session.

Fifteen selected lifecycle tests passed, covering Open at 99, atomic lock and
failed-payment rollback at 100, post-lock withdrawal rejection, round schedules
and draw ordering, ten distinct winners, winner-only and single claims,
`Claimable`, and final `Finished` position release.

The 99+1 plan is not execution authorization. The current five-wallet pilot
store must not be extended or reused. A future 99-wallet set, funding mechanism,
and each write phase require separate review and explicit authorization.

### Limitations and next step

The current `join()` accepts no expected pool ID or expected participant count.
An external account can therefore take the 100th position between the final
precheck and Piotr's manual confirmation, after which his join could route to a
new pool. Monitoring and a short handoff reduce but cannot eliminate this
public-mempool race. A deterministic guard would require a reviewed contract
change and new deployment; that remains a separate decision.

The safest next implementation unit is a separately reviewed initializer and
read-only inspection path for a new 99-wallet test set. It must not create the
real store until Piotr explicitly runs the manual initializer in a later task.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `e2ef6387398171459c73c6b71e1459d3bf2602a7`
- Starting message: `feat(operator): prepare guarded two-wallet Base Sepolia pilot`
- The documentation milestone commit hash did not exist when this entry was
  written and is intentionally not guessed.

## 2026-07-18 - Guarded two-wallet Base Sepolia write pilot prepared

### At a glance

The five-wallet pilot completed public read-only status and dry-run checks for
the first two and all five wallets without modifying any artifact or sending a
transaction. A separately guarded launcher is now prepared for a reversible
faucet, exact approval, join, and Open-pool withdrawal sequence using only
wallet indices 0 and 1. It has not been funded or executed.

### Completed

- Reused the existing Base Sepolia smoke signer, receipt verification,
  transaction journal, and conservative recovery coordinator instead of
  introducing another write transport.
- Added existing-store-only signer selection: the authenticated store envelope
  is checked, but only entries 0 and 1 become connected signer objects.
- Added a shared-journal wallet scope that permits only faucet, exact 33 dUSDC
  approval, join, and withdrawal for pool 1 and rejects wallets 2-4, draw,
  claim, deployment, administration, another chain, contract, or token.
- Added two exact authorization phrases, dynamic buffered gas checks, sequential
  wallet execution, final zero-position/zero-allowance/zero-claimable checks,
  bound checkpoint updates, and immutable store/manifest hash checks.
- Documented manual MetaMask funding separately from operator execution. No
  funding-wallet secret or automatic funding path is accepted.

### Verification boundary

- Automated coverage includes exact confirmations, exact wallet range, shared
  journal isolation, prohibited actions and identities, selected signer
  loading, wrong-password rejection, missing-store refusal, plus the existing
  smoke tests for wrong chain, deployment identity, insufficient ETH, receipt
  ambiguity, recovery, redaction, and absence of draw/claim paths.
- The launcher and operator were not run against the real password-protected
  set. No password, private key, seed phrase, or funding credential was
  requested or received.
- No Base Sepolia funding, faucet, approval, join, withdrawal, draw, claim,
  deployment, Production, Vercel, frontend, or Farcaster action occurred.

### Limitations and next step

Piotr must manually fund wallet 0 and wallet 1 with testnet ETH, review their
public balances and the unchanged pilot identity, and then manually run the
PowerShell launcher. Any pending or ambiguous operation requires journal and
on-chain recovery review before another write decision.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `7b0f6dd6aae2a80689e778128c3efedf1251b546`
- Starting message: `fix(operator): handle Base Sepolia read rate limits`
- The milestone commit hash did not exist when this entry was written and is
  intentionally not guessed.

## 2026-07-18 - Bounded public-RPC retries for the read-only pilot

### At a glance

Piotr's manual Base Sepolia preflight succeeded for the first two wallets in
the encrypted five-wallet pilot set. All artifacts and deployment identity
checks passed, both wallets had zero balances and nonces, and no transaction
was signed or broadcast. The next five-wallet status read stopped on public
RPC error `-32016: over rate limit` while reading the pending nonce.

### Completed

- Added one reusable retry boundary around every individual public RPC read and
  read-only gas estimate. It recognizes explicit JSON-RPC, message, and HTTP
  rate-limit evidence but does not retry contract, password, artifact, or other
  non-transient failures.
- Bounded execution to five attempts with 500 ms exponential backoff, a
  4-second delay cap, 20% jitter, sanitized attempt logging, and a clear hard
  stop after exhaustion.
- Replaced concurrent identity, round, wallet, and nonce reads with sequential
  operations and added 200 ms pacing between wallets in the public entrypoint.
- Preserved the technical read-only boundary: no signer, private-key runtime,
  transaction transport, lifecycle execution, funding, or artifact mutation
  was added.

### Verification boundary

- Automated tests cover immediate success, one and several transient failures,
  exhausted attempts, immediate non-transient failure, wallet ordering and
  concurrency, secret redaction, absence of write primitives, and byte-for-byte
  preservation of pilot fixtures.
- TypeScript, Hardhat compilation, all 205 contract/operator tests, the local
  100-position smoke, the 617-operation local operator lifecycle, and the root
  ESLint check passed. The focused retry/operator/pilot group passed 38 tests.
- `npm audit --omit=dev` found zero production dependency vulnerabilities in
  `packages/contracts`. The unchanged root dependency graph still reports 38
  known findings (27 moderate and 11 high); no audit fix was run in this task.
- Codex did not rerun the real password-protected pilot. The five-wallet status
  and two- and five-wallet dry-runs remain manual steps for Piotr.
- No Base Sepolia write, funding, faucet, approval, join, withdrawal, draw,
  claim, deployment, frontend, Vercel, Production, or Farcaster change occurred.

### Limitations and next step

Piotr must manually rerun status for all five wallets, followed by dry-run for
the first two and all five, while comparing SHA-256 for all four external
artifacts before and after. A successful read-only report is not authorization
for funding or any transaction.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `5fc81e97a3849e11fe4c34c9848e977daf6c67e7`
- Starting message: `feat(operator): add secure pilot wallet initialization`
- The milestone commit hash did not exist when this entry was written and is
  intentionally not guessed.

## 2026-07-18 - Secure five-wallet pilot-set initializer

### At a glance

A manually gated initializer now prepares the four external artifacts required
for a five-wallet Base Sepolia read-only pilot: an encrypted wallet store, a
non-secret set manifest, a bound checkpoint, and an empty bound transaction
journal. Only disposable test fixtures were initialized. Piotr has not run the
real launcher, no target pilot wallet exists yet, and no wallet was funded or
used for a transaction.

### Completed

- Reused the existing scrypt and AES-256-GCM implementation with its random
  salt, random IV, authenticated integrity, external path validation, private
  file writes, and no-overwrite behavior; no second cryptographic format was
  introduced.
- Added a versioned operator-set binding for project `POP33`, purpose
  `base-sepolia-operator-pilot`, chain `84532`, wallet count 5, the recorded
  contract/token addresses, the encrypted store UUID, and a digest of the
  ordered public addresses.
- Added backwards-compatible version 2 checkpoint and journal formats. The
  existing local version 1 state remains valid, while a public pilot hard-stops
  unless manifest, checkpoint, journal, encrypted store ID, and address order
  all match.
- Added atomic directory initialization: exactly five wallets and all metadata
  are created in a temporary external sibling directory, fully reopened and
  validated, and only then renamed to the final target. Existing targets and
  paths inside the worktree are refused.
- Added one reviewed PowerShell launcher with an exact confirmation phrase,
  two hidden `SecureString` prompts, case-sensitive password comparison,
  a child-specific `ProcessStartInfo` environment, BSTR zeroing, and guaranteed
  cleanup of the temporary child variables. Neither password nor keys are CLI
  arguments or output, and the password is never added to the PowerShell
  process environment.
- Added backup and recovery guidance that keeps all four files together,
  stores the password separately, avoids automatic cloud/GitHub upload, and
  validates a restored encrypted copy without displaying key material.

### Verification boundary

- Initializer tests created only temporary five-wallet fixtures and confirmed
  uniqueness, correct decryption, wrong-password rejection, no overwrite,
  external paths, exact identity, store-ID binding, address order, corrupted
  state rejection, repeatable opening, log redaction, first-2/all-5 read-only
  dry-runs, and continued absence of every write transport.
- The PowerShell launcher was parsed and inspected but was not interactively
  executed. Codex did not request, receive, store, or display Piotr's password.
- TypeScript, Hardhat compilation, all 196 contract/operator tests, the local
  100-position smoke, the 617-operation local operator lifecycle, and the root
  ESLint check passed. The 14 focused initializer tests also passed after the
  final launcher review.
- `npm audit --omit=dev` found zero production dependency vulnerabilities in
  `packages/contracts`. The unchanged root dependency graph still reports 38
  known findings (27 moderate and 11 high); dependency remediation was outside
  this initializer milestone and no automatic or breaking audit fix was run.
- No real pilot directory, production wallet, 100-wallet store, funding,
  faucet, approval, join, withdrawal, draw, claim, deployment, Vercel change,
  Production change, or Farcaster integration occurred.

### Limitations and next step

Piotr must manually run the reviewed PowerShell launcher, choose and retain the
password outside the repository, make a separate encrypted backup of the full
four-file directory, and then run only read-only preflight/dry-run for the first
two and all five wallets. Funding and every write remain separate, unauthorized
future stages. A 100-wallet set must never reuse this pilot store ID or folder.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `63ae26964e21d689253e908da4e5c64146f0ce66`
- Starting message: `feat(operator): add Base Sepolia read-only dry run`
- The milestone commit hash did not exist when this entry was written and is
  intentionally not guessed.

## 2026-07-18 - Base Sepolia multi-wallet read-only operator

### At a glance

A separate multi-wallet operator now connects to the recorded Demo V1 contracts
on Base Sepolia for public reads and dry-run planning while keeping every write
transport technically unavailable. The live network and contract identity
preflight succeeded, but no encrypted wallet store, checkpoint, or journal is
configured in this workspace, so 2-, 5-, and 100-wallet readiness remains
blocked and no wallet-backed lifecycle dry-run was claimed.

### Completed

- Added `preflight`, `status`, `plan`, and `dry-run` CLI modes with bounded
  first-2, first-5, full-100, custom-count, and explicit start-index ranges.
- Added a provider-only Base Sepolia runtime fixed to chain `84532`, the
  recorded dUSDC and POP33 addresses, deployed bytecode, token linkage, and all
  fixed Demo V1 parameters.
- Added read-only inspection of an existing AES-256-GCM/scrypt wallet store,
  checkpoint, and transaction journal. Missing files are never created, wallet
  keys are not returned to the runtime, and ordered wallet identity must match
  the checkpoint and journal project identity.
- Added per-wallet balances, latest/pending nonces, allowance, cooldown,
  membership, claimable amount, journal state, operation plan, gas estimate,
  wei cost, 2x reserve and aggregate lifecycle reporting in text and JSON.
- Added explicit unavailable estimates for state-dependent future joins,
  withdrawals, draws, and claims rather than substituting invented values.
- Added tests for fixed identity failures, store safety, range boundaries,
  duplicates, recovery blockers, confirmation depth, report redaction,
  repeatability, nonce preservation, and absence of every signing/broadcast
  primitive from the public runtime.

### Verification boundary

- Hardhat compilation and the contracts-package TypeScript check passed. All
  182 contract/operator/smoke Mocha tests passed, including 15 isolated tests
  for the new public read-only operator; automated tests used no public RPC.
- The local Demo V1 smoke completed 100 joins, ten draws and ten claims to
  `Finished`. The local operator lifecycle completed 617 unique confirmed
  journal operations and ended at `Finished` with zero escrow and zero active
  positions. Neither command used an external RPC.
- Root lint, all 20 frontend domain tests, and the production build passed.
  The contracts production audit reported zero findings. The root production
  audit retained the known 38 transitive findings (27 moderate, 11 high, zero
  critical); no automatic audit fix was run.
- A credential-free public RPC preflight confirmed chain `84532`, bytecode,
  exact runtime identity, pool 1 Open at 0/100, zero escrow, and ten remaining
  draws and claims.
- The preflight correctly reported missing external wallet store, checkpoint,
  and journal as blockers. It did not generate wallets or state files.
- No private key, funded account, wallet request, signature, transaction,
  faucet, approval, join, withdrawal, draw, claim, deployment, Vercel change,
  Production change, or Farcaster integration occurred.
- A dry-run is planning evidence only and does not prove the public lifecycle.
  A 2–5 wallet pilot still requires a separate stage and explicit approval;
  the 100-wallet lifecycle remains unexecuted.

### Limitations and next step

Provision and independently back up a suitable external encrypted wallet
store plus a matching Base Sepolia checkpoint and empty or fully reconciled
journal. Then rerun only the first-2 and first-5 read-only preflight/dry-run and
review gas funding requirements. Do not enable or execute writes in that stage.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `aefc57e9256eb988795284f7f629ebcb7f791825`
- Starting message: `docs: reconcile POP33 project sources of truth`
- The milestone commit hash did not exist when this entry was written and is
  intentionally not guessed.

## 2026-07-18 - Published Demo V1 contract sources

### At a glance

The source for both current POP33 Demo V1 contracts on Base Sepolia was
published and independently confirmed in BaseScan and Sourcify. BaseScan shows
an exact match for `Pop33DemoUSDC` at
`0xA7FA084b34c888061757d4b5FBb08a7B53fee786` and `Pop33BasicV1` at
`0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F`. Sourcify reports exact creation
and runtime matches for both addresses on chain `84532`.

### Completed

- Added the official `@nomicfoundation/hardhat-verify` tooling compatible with
  the existing Hardhat 3 workspace.
- Added a read-only Base Sepolia verification network with `accounts: []`, a
  runtime-only `ETHERSCAN_API_KEY`, and a runtime-only public RPC URL.
- Added separate, explicit BaseScan commands for the demo token and main
  contract, both using the deployment-compatible `default` build profile and
  the provider-specific `verify etherscan` task.
- Confirmed the published compiler as `0.8.28+commit.7893614a`, optimizer
  enabled with 200 runs, and EVM version `cancun`.
- Confirmed both constructor argument sets, including the deployed dUSDC
  address used by `Pop33BasicV1`.
- Reconfirmed that the repository sources were unchanged from the deployment
  source commit and that the local runtime bytecode matched both deployed
  contracts after applying the artifacts' immutable references.

### Verification boundary

- No private key or signer was used. Source publication did not deploy a
  contract, send a transaction, or modify blockchain state.
- The generic multi-provider Hardhat task reported Blockscout `Unknown UID`
  even though BaseScan and Sourcify succeeded. The maintained commands now
  target Etherscan API V2 directly, so a real BaseScan error remains fatal and
  an unrelated Blockscout polling error cannot produce a false overall result.
- Blockscout's public API later showed both contracts as fully verified, but
  Blockscout is additional evidence rather than the required explorer for this
  milestone.
- Source verification proves source-to-bytecode correspondence; it is not a
  security audit. The Demo V1 testnet randomness remains manipulable, and the
  complete 100-wallet lifecycle remains unexecuted.
- Production and Farcaster remained unchanged.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `b512572c3458072626d35a5fad979cc8b09de97b`
- Starting message: `docs: record verified public UI transaction test`
- The milestone commit hash did not exist when this entry was written and is
  intentionally not embedded in the commit that it identifies.

## 2026-07-18 - Verified reversible public UI transaction flow

### At a glance

The public Vercel Preview for `codex/pop33-recovery`, deployed from commit
`e64c689`, passed its first controlled and reversible transaction test through
`/#/demo-v1` on Base Sepolia. The dedicated test wallet displayed as
`0xE9cA...5F4a` completed an exact approval, join, and Open-pool withdrawal.
The frontend displayed confirmed and semantically verified results for both
join and withdrawal.

### Completed

- Used the public Preview branch alias at
  `https://pop33-demo-git-codex-pop33-recovery-profitmilions-projects.vercel.app`.
- Connected the dedicated `Pop33 Smoke Clean` wallet on Base Sepolia chain
  `84532`; its initial UI state was approximately 0.00010 ETH, 330 dUSDC, zero
  allowance, no active positions, and pool 1 Open at 0/100 with zero escrow.
- Approved exactly 33 dUSDC and submitted a separate join transaction.
- Confirmed that join created position 4 in pool 1. The UI showed 297 dUSDC,
  zero allowance, one active position, pool 1 at 1/100, and 33 dUSDC escrow.
- Withdrew position 4 while pool 1 remained Open. The UI verified that the
  position became inactive and that the exact 33 dUSDC refund restored 330
  dUSDC, zero allowance, no active positions, pool 1 at 0/100, and zero escrow.
- Confirmed that draw and claim progress remained 0/10 after the reversible
  test.

### Verification boundary

- The faucet was not exercised in this session because the wallet already held
  330 dUSDC.
- This test covered one dedicated wallet and one position. It did not exercise
  100 participants, the transition to `Locked`, any draw or claim, or the full
  100-position and ten-round lifecycle through the public UI.
- No mainnet funds were used. This remains a Base Sepolia Demo V1 checkpoint,
  not evidence of a production or mainnet-ready product.
- Vercel Production and Farcaster remained unchanged; Farcaster is still not
  implemented.
- No transaction hashes are recorded because none were supplied by a verified
  local source for this documentation checkpoint.

### Next logical step

Retain the clean reversible state and separately review the scope and safety
requirements before authorizing any public faucet, pool-locking, draw, claim,
or complete lifecycle test. Production and Farcaster remain outside that work.

### Git

- Branch: `codex/pop33-recovery`
- Deployment and starting checkpoint:
  `e64c6891c241a18a2f2156e3228af3670c4be7af`
- Starting message: `fix: harden Demo V1 public transaction flow`
- The documentation commit hash did not exist when this entry was written and
  is intentionally not embedded in the commit that it identifies.

## 2026-07-18 - Verified independent Web3 Demo V1 on public Vercel Preview

### At a glance

The current Demo V1 was manually verified as a public, standalone Web3
application on a Vercel Preview. The landing page and both Demo V1 routes
loaded through a normal public URL and read the recorded contracts on Base
Sepolia. Farcaster is not integrated and was not required for this runtime.

### Completed

- Confirmed the Vercel environment as `Preview`, the branch as
  `codex/pop33-recovery`, the source commit as
  `9b51afc015f4848ac7b184507dda00f753e6e86d`, and the deployment status as
  `Ready`.
- Confirmed the branch alias:
  `https://pop33-demo-git-codex-pop33-recovery-profitmilions-projects.vercel.app`.
- Confirmed that the Vercel Preview environment contained the four public Demo
  V1 values:
  `VITE_POP33_DEMO_V1_CONTRACT_ADDRESS`,
  `VITE_POP33_DEMO_V1_TOKEN_ADDRESS`, `VITE_POP33_DEMO_V1_CHAIN_ID`, and
  `VITE_POP33_DEMO_V1_RPC_URL`.
- Confirmed after the resulting Preview redeployment that the previous
  missing-configuration message no longer appeared.
- Confirmed that the landing page linked to the current Demo V1 rather than
  requiring a Farcaster environment.

### Public runtime verification

- `/#/demo-v1` read Base Sepolia chain `84532`, `Pop33BasicV1` at
  `0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F`, and dUSDC at
  `0xA7FA084b34c888061757d4b5FBb08a7B53fee786`.
- The page showed the 33 dUSDC entry, 330 dUSDC faucet amount, 86,400-second
  cooldown, ten-active-position limit, and one open pool.
- Pool 1 showed `Open`, 0/100 positions, zero escrow, 0/10 draw progress,
  0/10 claim progress, and ten Pending rounds.
- `/#/archive-v1` showed the same pool and ten Pending rounds with no schedules,
  executed draws, winners, assigned prizes, or claims, plus the contract
  inspection link.

### Verification boundary

- This was a read-only browser verification. No wallet was connected and no
  faucet, approval, join, withdrawal, draw, claim, or other transaction was
  submitted through the public URL.
- No smart contract was deployed or changed, and no Base Sepolia transaction
  was sent as part of this milestone.
- Vercel Production was not promoted, redeployed, or changed. The last observed
  Production remained on branch `master`, commit `93ecdf7`, at
  `pop33-demo.vercel.app`; it is not evidence for the current Demo V1 runtime.
- Farcaster remains unimplemented. The verified Preview is the independent Web3
  application and does not depend on a social-platform runtime.

### Next logical step

Review the hosted transaction UX and safety boundaries, then separately decide
whether to authorize one controlled wallet flow through the public Preview.
Production and Farcaster remain outside that next read/write verification
decision.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `9b51afc015f4848ac7b184507dda00f753e6e86d`
- Starting message: `docs: record successful resumed Base Sepolia smoke test`
- The documentation commit hash did not exist when this entry was written and
  is intentionally not embedded in the commit that it identifies.

## 2026-07-17 - Successful resumed Base Sepolia reversible smoke test

### At a glance

The successful resumed Base Sepolia reversible smoke test reused the original
recovery journal. It revalidated and skipped the previously confirmed dUSDC
faucet and exact approval, then executed only one join and one withdrawal for
position 3. The final read-only verification confirmed the exact 33 dUSDC
refund and no residual position, allowance, participant, escrow, prize, or
pending transaction.

### Completed

- Retained the existing journal and its original faucet and approval operation
  IDs instead of creating a new run or replaying either transaction.
- Revalidated the confirmed faucet at nonce 0 and exact 33 dUSDC approval at
  nonce 1 against their public transactions, receipts, calldata, and events.
- Confirmed one join at nonce 2, which created position 3 in pool 1 and moved
  exactly 33,000,000 dUSDC units into escrow.
- Confirmed one withdrawal at nonce 3, which deactivated position 3 and returned
  exactly 33,000,000 dUSDC units to the dedicated smoke wallet.
- Completed post-receipt semantic verification with the bounded read-retry
  guard available and without any automatic broadcast retry.

### Public evidence

- Faucet: `0xf948c74e13dc9947a04627abf1a9ed3abe08805cef95289dabcb08ea4e1e4dca`,
  block 44275699, gas used 74,750.
- Approval: `0x33fbb15a82f4112eb82f630afca68ae9a1b492670ac893fe62a84c1ba98a1497`,
  block 44275701, gas used 46,330.
- Join: `0x3793505779eb8fe95843903bd3bac524e470af337c5cd348b940c3cbd7e6c1d1`,
  block 44277341, gas used 390,755.
- Withdrawal: `0xb1383a7f73188bc726f02de67070a430cac82e784a57cf2a4f7dc3a97649f0e5`,
  block 44277343, gas used 93,944.
- Final journal revision: 20; final journal SHA-256:
  `B6F19642862F0C7CD879F0609BF38481A1C203B910DE102843043A27E5F81C26`.

### Verification

- All four journal operations are `confirmed`; none is pending, failed, or
  marked `requires_manual_review`, and the journal contains no secret material.
- The dedicated wallet's latest and pending nonces are both 4, covering exactly
  the four journaled transactions at nonces 0 through 3 with no pending gap.
- The final wallet state is 330,000,000 dUSDC units, zero allowance, zero active
  positions, and zero claimable prizes.
- Pool 1 remains Open with zero active participants and zero escrow. Position 3
  remains as an inactive historical record owned by the smoke wallet.
- No draw, claim, deployment, replacement transaction, or multi-wallet operator
  action occurred. The main operator's public-write block remains unchanged.
- The documentation checkpoint itself used only public read-only RPC calls and
  did not load a private key, create a signer, or send a transaction.

### Limitations

- This is evidence for one reversible flow on Base Sepolia, not production or
  mainnet readiness and not authorization for another public smoke run.
- The deployed `join()` ABI still cannot atomically bind a transaction to an
  expected pool ID and participant count.
- The journal must remain preserved as evidence; a later independently approved
  smoke would require a separate run decision and a new external journal.

### Next logical step

Archive and independently review the public journal and transaction evidence,
while keeping every Base Sepolia write path for the 100-wallet operator blocked.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `0db1fa53b312cb928042ab0568c26369bce97255`
- Starting message: `fix: tolerate stale RPC reads after confirmed smoke transactions`
- The documentation commit hash did not exist when this entry was written and
  is intentionally not embedded in the commit that it identifies.

## 2026-07-17 — Base Sepolia smoke semantic-read recovery guard

### At a glance

The first controlled Base Sepolia write smoke confirmed one dUSDC faucet and
one exact 33 dUSDC approval, then stopped before join when an RPC backend briefly
returned the pre-approval allowance after the successful receipt. The recovery
journal was retained, and no join or withdraw was sent.

### Completed

- Confirmed the faucet and exact approval through their public calldata,
  events, receipts, nonces, and current token state.
- Added one reusable, bounded semantic-read retry for post-receipt state that
  never retries a broadcast, operation ID, nonce, or transaction.
- Kept exact equality for the 33,000,000-unit approval and added strict
  composite checks for faucet, join, and withdraw state transitions.
- Added regression coverage for stale allowance, faucet, join and withdraw
  reads, plus recovery from confirmed faucet and approval without replay.

### Verification

- All 167 contracts/operator Mocha tests passed, including 29 isolated smoke
  harness tests that use no public RPC.
- The contracts TypeScript `--noEmit` check passed.
- The real external recovery journal was inspected only read-only and retained
  its original fingerprint.
- No public transaction was sent during this implementation and verification
  task.

### Limitations

- The public smoke is not complete: join and withdraw remain unsent.
- A later recovery must be separately authorized and must reuse the existing
  journal so confirmed faucet and approval operations cannot be replayed.
- The deployed `join()` ABI still cannot bind a transaction atomically to an
  expected pool ID and participant count.

### Next logical step

After independent review of this checkpoint, perform a separately controlled
recovery using the existing journal, beginning from join and preserving every
pre-join and pre-withdraw safety gate.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint: `cba599000459034d878b5d07b8ef4a9c23e10ba6`
- Starting message: `feat: add guarded Base Sepolia smoke harness`
- The checkpoint commit hash did not exist when this entry was written and is
  intentionally not guessed.

## 2026-07-16 — Guarded single-wallet Base Sepolia smoke harness

### At a glance

A separate, default-read-only harness now prepares the smallest reversible
Demo V1 check: dUSDC faucet, exact 33 dUSDC approval, one join, position
verification, Open-pool withdrawal, and exact refund verification. The public
write mode was not executed, and the multi-wallet lifecycle operator remains
blocked from every Base Sepolia write.

### Goal

Prepare a narrowly scoped and recovery-aware way to inspect the recorded Demo
V1 deployment and, only after a separate explicit authorization and complete
preflight, operate one dedicated test wallet without enabling the 100-wallet
operator.

### Completed

- Added a separate `baseSepoliaSmoke` Hardhat network with no configured signer
  accounts and a read-only default command that does not require a private key.
- Bound the harness to the documented Base Sepolia chain, dUSDC address and
  `Pop33BasicV1` address, with bytecode, linkage, metadata, parameter, pool,
  wallet, cooldown, balance and gas checks.
- Added an explicit write CLI flag, two exact confirmations, a dedicated
  runtime-only smoke key, rejection of the recorded deployment wallet, a
  ten-position safety margin and a hard stop at 98 active positions.
- Limited writes to faucet, exact approval, join and Open-only withdrawal. Draw,
  claim, deployment, administration and multiple-wallet use are unavailable.
- Reused the durable journal and conservative recovery model with stable
  operation IDs, calldata and event evidence, explicit receipt timeouts,
  bounded read retries, mined replacement/cancellation discovery and no
  automatic rebroadcast of pending or ambiguous work.
- Documented safe operation, recovery, BaseScan inspection and the prohibition
  on storing secrets in GitHub, Vercel, `.env`, command arguments or `VITE_*`.

### Significance for POP33

This stage separates a minimal reversible public-testnet diagnostic from the
full lifecycle operator. It improves the evidence and failure boundaries needed
before any public smoke transaction, but it does not authorize deployment,
production operation, real USDC, draws, claims, or the multi-wallet operator.

### Verification

- Hardhat compilation and the contracts-package TypeScript check passed.
- All 163 contracts/operator Mocha tests passed, including 25 isolated smoke
  harness tests that use no external RPC.
- The local multi-wallet lifecycle still completed 617 unique confirmed journal
  operations and ended in `Finished` with zero escrow and no active positions.
- Root lint, production build and all 8 frontend domain tests passed.
- The contracts production dependency audit reported zero findings. The root
  audit retained the known 38 findings: 27 moderate, 11 high and zero critical.
- No contract or deployment script changed. No public RPC preflight, public
  transaction, deployment, draw or claim occurred during this milestone.

### Limitations

- The dedicated smoke RPC and public smoke-wallet configuration were absent, so
  the external read-only preflight could not be run. No wallet was created and
  no private key was requested or stored.
- The deployed `join()` function cannot atomically bind a transaction to an
  expected pool ID and position count. The stricter margin and immediate
  rechecks reduce but cannot remove this public ordering race.
- Standard RPC cannot expose every pending same-nonce replacement. Evidence
  outside the bounded mined-block scan remains a manual-review case.
- Source publication in BaseScan and the known root dependency migration remain
  separate work.

### Next logical step

Configure an already existing dedicated smoke wallet by public address, a
credential-controlled HTTPS RPC and sufficient Base Sepolia ETH outside the
repository, then run only the read-only preflight and independently review its
output before considering a separately authorized write smoke.

### Git

- Branch: `codex/pop33-recovery`
- Starting checkpoint commit: `fe99e39b5d2c80cd425c9d6f3c90d2846ed1fe0c`
- Starting checkpoint message: `feat: add durable operator wallet and transaction recovery`
- The milestone commit hash did not exist when this entry was written and is
  intentionally not guessed.

### Communication potential

- Development post: why one reversible wallet flow was separated from a
  100-wallet lifecycle operator.
- Technical insight: treating receipt timeout, pending nonce and replacement
  evidence as recovery states rather than reasons to resend.
- Security note: why a public read-only preflight can be useful without loading
  a private key and why a contract-level pool/count guard is still needed.

## 2026-07-15 — Local Demo V1 lifecycle operator

### At a glance

The local operator completed the full Demo V1 lifecycle and passed all 127
tests. This confirms local execution, but it does not mean that the operator
is ready for Base Sepolia or production.

### Goal

Build a local operator managing multiple wallets that can safely and
repeatedly complete the full Demo V1 lifecycle and verify its invariants before
preparing the operator for execution on a public testnet.

### Completed

- Added a modular operator intended exclusively for local use, with modes for
  reads, local ETH funding, faucet use, exact approval, pool joining,
  withdrawal from an open pool, draws, and prize claims.
- Added a hard stop at 99 positions and a separately confirmed 100th join that
  locks the pool.
- Completed the full local lifecycle: withdrawal and refill before lock,
  reaching 100/100, ten sequential draws with different winning positions,
  ten correct claims, transition to `Finished`, zero escrow, and release of
  all active positions.
- Added checkpoint validation and reconciliation of stored data against the
  current local network state.
- Base Sepolia writes remain deliberately unimplemented and blocked.

### Significance for POP33

This stage delivered a repeatable local tool for verifying the complete Basic
V1 flow and its critical security boundaries before using a public network. It
confirmed the consistency of the local process from position preparation to
final pool settlement, but it does not confirm that the operator is ready for
Base Sepolia or production.

### Verification

- The full local operator lifecycle completed successfully.
- The internal security review found no blocking issues within the tested local
  scope.
- 119 Mocha tests in `packages/contracts` and 8 frontend domain tests were
  executed; all 127 tests passed.
- Git confirmed the `codex/pop33-recovery` branch, the specified commit, and
  0/0 synchronization between `HEAD` and `origin/codex/pop33-recovery` before
  this file was created.
- No public transactions or new deployment occurred during this stage.

### Limitations

- The operator runs locally and is not yet ready for Base Sepolia.
- Operator wallets and the default checkpoint are process-bound; a persistent,
  encrypted wallet mechanism and complete restart-safe recovery are missing.
- A transaction is not durably journaled immediately after broadcast and
  before its receipt, and an approved public recovery runbook does not yet
  exist.
- The current `join()` interface does not atomically bind a transaction to an
  expected pool ID and position count, so local post-receipt validation does
  not remove the public-network race condition.
- After a pool is locked, the contract provides neither participant withdrawal
  nor an administrator rescue path.

### Next logical step

Complete the requirements for safe public-testnet execution—persistent
encrypted wallets, transaction journaling, hash/nonce recovery, gas-funding
preflight, independent review, and an approved runbook—before considering
whether to enable Base Sepolia writes for the operator.

### Git

- Branch: `codex/pop33-recovery`
- Commit: `e706cb5c3db84a91a49ae30a48837ce16f8c5105`
- Commit message: `feat: add local Demo V1 lifecycle operator`

### Communication potential

- Development post: why the full lifecycle was completed locally before the
  operator receives access to a public testnet.
- Educational material: the difference between a correct contract lifecycle
  and safely operating multiple wallets.
- Technical insight: the hard 99/100 boundary and separate confirmation for
  the operation that atomically locks the pool.
- “Building in public”: present the confirmed 127 tests together with a clear
  list of reasons why this stage still does not mean Base Sepolia readiness.

## Earlier confirmed milestones to reconstruct

- 2026-07-11 — Organization of product documentation, business rules, and
  development status; confirmed by Git and the documents created. A full entry
  requires later reconstruction.
- 2026-07-13 — Verified and tested `Open -> Locked` contract core for POP33
  Basic V1; confirmed by Git, the specification, implementation, and tests. A
  full entry requires later reconstruction.
- 2026-07-14 — Completion of the local Basic V1 contract lifecycle; confirmed
  by Git, implementation, documentation, and tests. A full entry requires
  later reconstruction.
- 2026-07-14 — Preparation and controlled deployment of the Demo V1 dUSDC and
  `Pop33BasicV1` pair on Base Sepolia; confirmed by Git and the deployment
  register in the documentation. The detailed process requires later
  reconstruction.
- 2026-07-14 — Separate Base Sepolia Demo V1 frontend integration; confirmed
  by Git, implementation, and documentation. A full entry requires later
  reconstruction.
