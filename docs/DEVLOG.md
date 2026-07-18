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
