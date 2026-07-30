# POP33 Development Status

Last reviewed: 2026-07-30

Branch reviewed: `codex/pop33-lifecycle-plan-revalidation`

Status: active development

## Summary

The repository contains an evolving React frontend, historical local prototype
layers, developer tooling, and an initial Base Sepolia integration. The local
simulation is a development aid, not a separate target product model.

The demo is expected to converge on the same business flow and architecture as
the future mainnet product. Several approved rules are not yet represented in
the current implementation.

The target Basic V1 parameters and lifecycle are now documented in
`docs/BASIC_V1_SPEC.md`: 100 positions at 33 USDC, 10 sequential draws with 10
different winning positions, 330 USDC per draw, pull-based claims, and
`Open -> Locked -> Drawing -> Claimable -> Finished`.

A separate, reproducible Hardhat 3 + TypeScript workspace exists in
`packages/contracts`. Its deployed Demo V1 `Pop33BasicV1` contract implements the
approved `Open -> Locked -> Drawing -> Claimable -> Finished` lifecycle,
including ten scheduled rounds, bounded non-repeating test winner selection,
explicit prize accounting, pull-based claims, and position release at
`Finished`. The legacy frontend and its existing Base Sepolia deployment remain
in the repository, but the ordinary `#/demo` route no longer exposes the old
wallet action. The browser-local simulator remains explicitly isolated at
`#/demo?view=dev`.

The contract workspace now also contains a read-only
multi-pool lifecycle supervisor. Its deterministic core accepts an explicit
snapshot time, returns exactly one prioritized `nextAction` per pool, detects
draw timing, outstanding claims and lifecycle/accounting inconsistencies, and
uses exact `bigint` values plus a deterministic plan ID. The CLI supports
human-readable and JSON output with pool/action/severity filters. A separate
viem public-read adapter now reads the canonical Demo V1 deployment at one
pinned Base Sepolia block, supports bounded pool ranges and historical block
overrides, and imports the existing frontend ABI and address source. It has no
keys, wallet client, transaction path, contract changes, or frontend changes;
`docs/LIFECYCLE_SUPERVISOR.md` records its scope and safety boundary.

The supervisor now also supports versioned saved lifecycle action plans and
read-only freshness revalidation. A plan binds one pool recommendation to its
source, chain, contract, interface identifier, pinned block, round, counters,
accounted escrow, and other minimal critical assumptions. All blockchain
integers remain canonical decimal strings, and a key-order-independent SHA-256
fingerprint detects accidental or inconsistent edits. Revalidation reads a
fresh snapshot and returns `VALID`, `STALE`, `BLOCKED`, `INCOMPLETE`, or
`INVALID_PLAN`, with compact field-level differences and distinct CLI exit
codes. A configurable 7,200-second default age ceiling supplements rather than
replaces full state comparison. The module remains read-only and contains no
key, signer, wallet client, Draw execution, transaction, contract, ABI,
frontend, or deployment change.

The public product surface is now intentionally limited to the landing page,
`#/demo-v1`, and `#/archive-v1`. The landing describes the deployed 33 dUSDC,
100-position, ten-round Demo V1 parameters and clearly separates the future
product vision from current testnet functionality. The preserved `#/demo` and
`#/archive` entries are labelled legacy/DEV and are not linked from the public
Demo V1 navigation.

The Demo V1 source now includes a mobile-first **Przygotowanie do Demo**
readiness panel. It detects an available injected wallet, connection state,
Base Sepolia chain `84532`, a conservative test-ETH threshold, dUSDC balance,
faucet cooldown, exact 33 dUSDC allowance, active-position capacity, and Join
eligibility. It presents one dominant next action in order: connect, switch
network, obtain test ETH from the official Base faucet list, obtain dUSDC,
approve exactly 33 dUSDC, and join. Approval and Join are now deliberately
separate user actions. Missing mobile providers are directed to a compatible
wallet's built-in browser; WalletConnect and new wallet dependencies were not
added.

This onboarding change is verified only in the local source worktree at
`e41cfd0f8230b367fe646bf39ece2b58d71ed448` plus uncommitted changes. It has not
been committed, pushed, or deployed to Vercel Preview, Production, or
Farcaster. The current public Preview therefore continues to represent its
previous deployed source until a separately approved deployment occurs.

The controlled Demo V1 pair is now deployed on Base Sepolia. It
includes the POP33-owned, six-decimal POP33 Demo USD (`dUSDC`) faucet token and
keeps the existing external-token deployment variant separate. The new pair
path validates environment values, chain ID, conservative deployer gas reserves,
two independent confirmations, deployed bytecode, fixed faucet parameters, and
the linkage between dUSDC and `Pop33BasicV1`. Local commands deploy the same
pair and exercise the faucet through the full lifecycle. Runtime bytecode,
creation inputs, getters, constructor linkage, and the empty initial pool were
verified on-chain. One faucet drip was tested; no approve or POP33 lifecycle
write was performed during deployment.

The source for both current Demo V1 contracts is now published as an exact
match in BaseScan and is also available as an exact creation/runtime match in
Sourcify; Blockscout also reports both addresses as fully verified. Before
publication, the local sources were confirmed unchanged from the deployment
source commit, the compiler settings and constructor arguments were
reconstructed from build-info and artifacts, and the local runtime bytecode
matched the deployed bytecode after applying the recorded immutable references.
Source verification did not change the bytecode or blockchain state and is not
a security audit. The temporary testnet randomness remains manipulable, and the
complete 100-wallet lifecycle has not been executed.

The separate `#/demo-v1` integration is now confirmed as an independent public
Web3 application on a Vercel Preview for branch `codex/pop33-recovery` and
source commit `9b51afc015f4848ac7b184507dda00f753e6e86d`. The branch alias is
`https://pop33-demo-git-codex-pop33-recovery-profitmilions-projects.vercel.app`.
After the four public Demo V1 environment values were added to the Preview
scope and Vercel redeployed it, the landing page, `/#/demo-v1`, and
`/#/archive-v1` loaded successfully. The runtime read the recorded Base
Sepolia contract and dUSDC addresses and showed pool 1 as Open with zero active
positions, zero escrow, and ten Pending rounds. That initial verification was
read-only.

The hardened Preview deployment from commit `e64c689` has now also passed one
controlled, reversible public UI write test on Base Sepolia with the dedicated
test wallet displayed as `0xE9cA...5F4a`. The session started with 330 dUSDC,
zero allowance, no active position, and pool 1 Open at 0/100 with zero escrow.
The UI obtained an exact 33 dUSDC approval and joined position 4 to pool 1,
then semantically verified the receipt result: 297 dUSDC balance, zero
allowance, one active position, pool 1 at 1/100, and 33 dUSDC escrow. An
Open-pool withdrawal then marked position 4 inactive, returned exactly 33
dUSDC, and restored the verified final state to 330 dUSDC, zero allowance, no
active position, pool 1 at 0/100, and zero escrow. The faucet was not used in
this session. Draw, claim, pool locking, and the complete 100-position and
ten-round public UI lifecycle were not tested.

The public Preview is therefore confirmed for contract reads and for this
narrow approval, join, and withdrawal write flow.

A separate multi-wallet Base Sepolia operator entrypoint now supports only
`preflight`, `status`, `plan`, and `dry-run`. Its public runtime has no signer or
broadcast primitive: it uses a credential-free HTTPS provider for contract
reads and state-dependent `eth_estimateGas` calls. It validates chain `84532`,
both deployed bytecodes, token linkage and all fixed Demo V1 parameters before
planning. It inspects—without creating or modifying—the existing encrypted
wallet store, checkpoint, and transaction journal, reports both wallet nonces,
balances, allowance, cooldown, position, claimable amount, journal states and
gas requirements, and supports bounded ranges from 1 to 100 wallets.

The earlier contract-only public preflight confirmed the Base Sepolia runtime
and pool 1 at 0/100. Piotr has since manually created the external five-wallet
pilot store, manifest, checkpoint, and empty journal. A real public read-only
preflight for the first two stored wallets completed with all artifact checks
`OK`, chain `84532`, range `2/2`, zero ETH and dUSDC, zero allowances and
nonces, no active positions, and no journal operations. It did not load a key
into a signer, sign or send a transaction, fund ETH, or execute a lifecycle
action.

The first five-wallet `status` run reached the public RPC rate limit at
`eth_getTransactionCount(address, "pending")` and stopped without hiding the
error. All public RPC reads and read-only estimates now share a five-attempt
bounded retry with 500 ms exponential backoff capped at 4 seconds, 20% jitter,
sanitized attempt logs, sequential reads, and 200 ms pacing between wallets.
Non-rate-limit errors are not retried. Piotr subsequently completed `status`
for all five wallets and `dry-run` for the first two and all five. All four
external artifacts remained byte-for-byte unchanged and no write occurred.

The guarded Base Sepolia pilot for wallet indices 0 and 1 completed
successfully on 2026-07-18. Each wallet confirmed exactly four transactions in
order: faucet, exact 33 dUSDC approval, join of pool 1, and withdrawal while the
pool remained Open. Public receipts, calldata, expected events, journal data,
and current contract reads agree. Both wallets now have nonce `4/4`, 330 dUSDC,
zero allowance, zero active position, and zero claimable prize. Pool 1 is Open
with zero active positions and zero escrow. The manifest and encrypted wallet
store remained byte-for-byte unchanged; the bound checkpoint and journal
changed as expected to record the confirmed operations. There is no pending or
manual-review operation.

This successful reversible pilot is evidence for the guarded two-wallet write
path only. Wallets 2-4 were not used, and no draw, claim, deployment,
administration, mainnet, automatic funding, Production, Vercel, or Farcaster
action occurred. A complete Base Sepolia lifecycle remains unexecuted. The
recommended future test uses a new, separately initialized 99-wallet operator
set for automatic participants and Piotr's separate public wallet for the
manually confirmed 100th join. The existing five-wallet pilot store must not be
extended or reused for that test. Funding, automated accumulation, the manual
lock-boundary join, ten scheduled draws, and winner claims each require a
separate reviewed and authorized stage.

A separate exact-99 encrypted-store initializer and local read-only inspector
are now prepared for the future full-lifecycle participant set. They reuse the
existing scrypt and AES-256-GCM store format while keeping a distinct fixed
file identity. Dry-run performs no write or wallet generation. Future
initialization is create-only, requires an exact confirmation and two hidden
matching password entries, validates a temporary encrypted file before its
final rename. The existing launcher still creates no checkpoint or transaction
journal. A separate fixture-only exact-99 artifact layer now prepares a safe
manifest, lifecycle checkpoint, append-only journal, atomic local updates, and
a redacted local preflight. It binds exactly 99 ordered public addresses to the
store ID and encrypted-file fingerprint, preserves the cumulative
`5 -> 20 -> 50 -> 99` gates, detects pending/ambiguous/manual-review state, and
enforces the automatic hard stop at 99. The five-wallet pilot profile remains
compatible. The inspector
returns only format metadata, public index/address pairs, an encrypted-file
fingerprint, uniqueness and exact-count results; it has no RPC, signer,
funding, or transaction transport. Only temporary test fixtures were created.
Piotr's real 99-wallet store has not been initialized, no wallet was funded,
and no public transaction occurred in this checkpoint.

A fixture-only capped funding subsystem is also prepared for that exact-99
identity. It accepts recipients only from the validated ordered manifest,
requires canonical decimal wei strings, binds a public fixture signer identity,
and enforces a configurable minimum target, per-wallet ceiling, aggregate
budget, starting balance, and signer reserve. Deterministic local `plan`,
`inspect`, and `simulate` functions cover confirmed, failed, pending,
ambiguous, manual-review, already-funded, and restart behavior through the
shared append-only journal and checkpoint. The illustrative test amounts are
not approved operating constants; real values still require fresh gas and fee
evidence. No provider, signer credential, transaction transport, real funding
plan file, ETH transfer, or public runner was added.

A fixture-only cumulative accumulation coordinator now binds that funding plan
to the same manifest, checkpoint, and append-only journal. It fixes four
disjoint ranges at `0-4`, `5-19`, `20-49`, and `50-98`, requires a separate
exact authorization phrase for each cumulative `5 -> 20 -> 50 -> 99` gate, and
enforces sequential `funding -> faucet -> approve -> join` progress for one
wallet at a time. Confirmed work is skipped on restart, partial wallets resume
at their first unfinished operation, and failed, pending, ambiguous,
inconsistent-receipt, or manual-review outcomes stop the range immediately.
Fixture journal events are bound to the range, ordered-address digest, and
funding-plan ID. Completion of index 98 moves the checkpoint to
`awaiting-manual-100`; index 99 and an automatic `manual-100` operation are
unreachable. The module exposes only local `plan`, `inspect`, and `simulate`
functions and contains no RPC, signer, key loading, or transaction transport.

A fixture-only cumulative execution runner core now connects the coordinator's
next-operation decision to a narrow injected adapter. It accepts no arbitrary
wallet list: checkpoint, index, public address, operation type, and operation ID
all come from the exact-99 manifest, funding plan, and journal. It processes one
wallet at a time in `funding -> faucet -> approve -> join` order, skips
confirmed work on restart, and stops on the first failed, pending, ambiguous,
manual-review, timeout, identity, receipt, or semantic-state mismatch.
Confirmed receipts are reconciled against operation-specific snapshots:
funding amount and cap, faucet dUSDC delta, approval token/spender/allowance,
and join position/pool/count/cycle/lock state. The injected fixture adapter has
no RPC, provider, signer, key loader, or transaction transport. Index `98`
remains the last automatic wallet and completion moves to
`awaiting-manual-100`.

A separate fixture-only public execution protocol v1 and durable journal v2
model now define the missing per-transaction persistence boundaries without
changing the existing runner or journal v1. The protocol persists a full
unsigned request and locally supplied signed hash before simulated broadcast,
tracks nonce, fee caps, receipt block identity, semantic reconciliation,
configurable finality, canonical rechecks and recovery decisions, and rejects
backward state movement or automatic replacement. A fixture global run lock
binds the whole preflight/signer/journal/checkpoint session, while dual-source
evidence requires both read snapshots to describe the same exact block and
manifest identity. The public coordination overlay ends normal accumulation at
index 97 and reserves index 98 for a one-use, separately acknowledged
`boundary-99` gate; index 99 remains unreachable.

A fixture-only wallet-store v2 format also demonstrates 99 separately encrypted
records with per-record salt/IV/tag/ciphertext, ordered-set and whole-envelope
integrity, public inspection, selected-index decryption and create-only writing.
It rejects real-key-shaped input and has no wallet generator, signer, provider,
environment read or migration. The technical recommendation is to use a
production-reviewed per-wallet format before creating the real exact-99 store;
the current low-cost fixture KDF profile is not approved for real material.

The evidence, boundary behavior, funding estimates, phase gates, and operator
gaps for that future test are recorded in
`docs/PLAN_BASE_SEPOLIA_FULL_LIFECYCLE_99_PLUS_1.md`. The plan is not write
authorization.

Production remains separate and does not host the current Demo V1 checkpoint.
Farcaster is not implemented and is not required by this standalone Web3
runtime.

## Business-rule implementation matrix

| Approved rule | Implementation status | Notes |
| --- | --- | --- |
| One payment creates one position in a specific pool/cycle | **implemented in deployed Demo V1 and local frontend** | `Pop33BasicV1` transfers exactly 33 dUSDC with `SafeERC20`; the separate UI performs an exact approval and then `join()`. |
| One primary participation action creates one position per successful use | **implemented in deployed Demo V1 and public frontend** | `#/demo-v1` performs the exact 33 dUSDC approval and paid `join()` flow against `Pop33BasicV1`; the preserved old nonpayable integration is no longer exposed on ordinary `#/demo`. |
| Automatic assignment to an available pool | **implemented in deployed Demo V1 and exposed locally** | The contract selects the oldest qualifying open pool and creates another only when required, up to 10 open pools. |
| Maximum one active position per user in the same pool | **implemented in deployed Demo V1 contract** | Indexed membership prevents a second active position in one pool and routes a subsequent join to another qualifying pool. |
| Maximum 10 active positions per user | **implemented in deployed Demo V1 and exposed locally** | The contract enforces the limit; the UI reads the count and disables an ineligible join. |
| Position leaves the active limit when its pool reaches `finished` | **implemented in deployed Demo V1 and exposed locally** | The final settled claim atomically releases the pool's bounded set and refreshed UI reads reflect it. |
| The first draw does not release an active position | **implemented in deployed Demo V1 contract** | Positions remain active through `Locked`, `Drawing`, and `Claimable`, including after individual wins and claims. |
| Pool remains open/in collection until target participation | **implemented in deployed Demo V1 contract** | The contract keeps a pool Open through 99 active positions and locks atomically on the 100th. |
| Withdraw one position while its pool is open | **implemented in deployed Demo V1 and local frontend** | The owner action is enabled only for an active position in an `Open` pool. |
| Withdrawal removes the position from active pool state | **implemented in deployed Demo V1 contract** | The historical record remains indexed while active membership and pool accounting are cleared. |
| Withdrawal releases one slot from the user's active-position limit | **implemented in deployed Demo V1 contract** | Covered by contract tests, including reuse of the released slot. |
| Withdrawal returns the paid stablecoin | **implemented in deployed Demo V1 contract** | The contract returns exactly 33 dUSDC. The legacy frontend deployment remains separate and nonpayable. |
| No withdrawal after the pool is full and locked | **implemented in deployed Demo V1 contract** | The contract reverts withdrawal after Locked and retains participant active-position counts. |
| 100 positions at 33 dUSDC and no Basic V1 fees | **implemented in deployed Demo V1 contract** | Constants, escrow accounting, and boundary behavior are covered by automated tests. |
| Ten sequential draws with different winning positions | **implemented in deployed Demo V1 contract** | Each eligible call finalizes one numbered round and removes its winner from a bounded candidate set. The temporary entropy is not production-safe. |
| 330 dUSDC credited per round through claim accounting | **implemented in deployed Demo V1 contract** | Each finalized round credits exactly 330 dUSDC to its winning wallet; claims are round-specific, pull-based, and protected against unauthorized or repeated payout. |
| Hourly Base Sepolia round eligibility after `lockedAt` | **implemented in deployed Demo V1 contract** | Round `n` is eligible at `lockedAt + n * drawInterval`; boundary, early, duplicate, and out-of-order behavior is tested. Automation and production randomness remain deferred. |
| `Open -> Locked -> Drawing -> Claimable -> Finished` | **implemented in deployed Demo V1 and represented locally** | Pool and all ten round states are read from contract getters; all ten claims remain required for `Finished`. |
| Demo mirrors the final/mainnet product model | **partial** | The separate Demo V1 implements paid positions, Open-pool withdrawal, draws, claims, and the authoritative lifecycle on Base Sepolia. Production randomness, identity/compliance, and the complete public 100-position execution remain unfinished; the legacy `/demo` and developer simulation remain separate historical layers. |
| Demo differences limited mainly to network, test tokens, safety parameters, and developer tools | **partial** | The public surface now follows the current Demo V1 architecture and isolates legacy/DEV layers. Production randomness, automation, compliance, and the complete Base Sepolia lifecycle remain unfinished. |

## Implemented

- React, TypeScript, and Vite frontend.
- Hash-based routing for landing, demo, and archive.
- Responsive landing and demo UI.
- Browser-local cycle simulation for development.
- Local cycle selection and participant creation.
- Automatic and manual simulated draws.
- Developer panel with fake participants and reset controls.
- Winners history and archive UI.
- Injected wallet connection.
- Base Sepolia wagmi configuration.
- Retained legacy `openNextAndJoin()` integration code, no longer exposed as an
  action on ordinary `#/demo`.
- Basic legacy on-chain aggregate and per-wallet reads retained for historical
  and developer reference.
- Transaction pending, confirmation, and error states.
- `#/demo-v1` as the sole public product flow and `#/archive-v1` as its public
  on-chain archive.
- Ordinary `#/demo` presents only a legacy notice and a link to the current
  Demo V1; it cannot invoke the old contract.
- A synchronous single-intent guard covering wallet approval, submission, and
  confirmation to prevent rapid duplicate transaction requests.
- Wallet network readiness is derived from the active connector account chain,
  with a second `connector.getChainId()` check immediately before
  `writeContractAsync`; unsupported networks cannot open a transaction request.
- Local cycle presentation and controls confined to `/demo?view=dev` and
  explicitly labelled as browser-local, non-on-chain developer simulation that
  does not represent current Demo V1 economics or its complete lifecycle.
- The landing presents only the current Base Sepolia Demo V1 values: 33 dUSDC,
  100 positions, ten 330 dUSDC rounds, and an hourly test schedule. Future
  Mainnet scale and integrations are visibly separated as non-Demo vision.
- The local simulation component no longer depends on wallet or on-chain
  transaction status and its `POP IT` action is governed only by local state.
- An isolated Hardhat 3 + TypeScript workspace under `packages/contracts`.
- `Pop33BasicV1` Open/Locked source with SafeERC20, reentrancy protection,
  custom errors, indexed events, and bounded getters.
- A bounded, swap-and-pop active candidate set with at most 100 position IDs per
  pool; chronological join/withdrawal history is reconstructed from events.
- Constructor validation requiring deployed token bytecode and exactly 6
  decimals for the approved standard, non-rebasing USDC model.
- A six-decimal unrestricted `MockUSDC` clearly marked for tests only.
- Immutable per-pool configuration snapshots for entry price, capacity, round
  count, prize values, total prize amount, and draw interval.
- Ten explicit scheduled round records derived from `lockedAt` and the pool's
  snapshotted interval.
- A permissionless, synchronous, bounded temporary draw path with unique
  winners and explicit warnings that its block-derived entropy is manipulable
  and non-production.
- Per-round and aggregate assigned, claimable, claimed, and escrow balances.
- Pull-based `claim()` with winner authorization, double-claim protection,
  checks-effects-interactions, `SafeERC20`, and `ReentrancyGuard`.
- `Finished` after all ten prizes are claimed, with atomic bounded release of
  all 100 pool positions.
- Automated contract/operator coverage includes an isolated public read-only
  operator suite for network identity, ranges, storage inspection, gas
  planning, report redaction, repeatability, and absence of write transport.
  No automated test uses a public RPC; the exact current passing-test count is
  recorded in the latest DEVLOG entry.
- A named Hardhat `baseSepolia` OP network using configuration variables, with
  no committed credentials.
- A guarded external-token Base Sepolia deployment script plus a separately
  named dUSDC/Pop33 two-contract script. The latter uses two explicit
  confirmations and rechecks the second immediately before transaction two.
- A local-only deployment dry-run that deploys `Pop33DemoUSDC` and
  `Pop33BasicV1` to a fresh `hardhatOp` network and validates both contracts.
- A local Demo V1 smoke command covering 100 faucet drips, 100 joins, ten unique winning
  positions, ten claims, `Finished`, and complete prize/escrow reconciliation.
- A local-only modular multi-wallet operator with read-only preflight/status,
  Hardhat funding and faucet modes, exact approval, a hard 99-position stop,
  separately confirmed final join, safe Open-pool withdrawal, one-round draw,
  winner-mapped claim, and live-state checkpoint reconciliation.
- A repeatable local operator lifecycle covering withdrawal and refill before
  lock, 100/100 lock scheduling, ten distinct winners, ten correct claims,
  `Finished`, zero escrow, and release of all active positions. Base Sepolia
  writes remain deliberately unimplemented and blocked.
- A versioned encrypted operator-wallet store using scrypt and AES-256-GCM,
  with authenticated integrity checks, runtime-only password input, external
  absolute paths, atomic replacement, and stable wallet restoration.
- A separate versioned transaction journal with deterministic idempotency keys,
  nonce-before-broadcast and hash-before-receipt persistence, strict forward
  states, sanitized errors, and conservative restart recovery for confirmed,
  pending, replaced, cancelled, failed, and ambiguous operations.
- Journal coordination is integrated into every local lifecycle transaction.
  Confirmed and pending semantic operations cannot be broadcast again, while
  ambiguous evidence halts in `requires_manual_review`.
- A separate `operator:base-sepolia:read-only` command with `preflight`,
  `status`, `plan`, and `dry-run`; first-2, first-5, full-100, and explicit
  start-index ranges; fixed public deployment identity; read-only nonce and
  wallet-state inspection; live gas estimates where the current state permits;
  and explicit `NOT CURRENTLY ESTIMABLE` results otherwise. Its lower-level
  runtime exposes no funding, signing, or broadcast method.
- A separately confirmed `operator:base-sepolia:init-pilot-5` PowerShell
  launcher that creates exactly five external encrypted test wallets plus a
  bound manifest, checkpoint, and empty journal; it never accepts the password
  as a CLI argument and never prints keys or encrypted contents.
- A separate `operator:base-sepolia:wallet-store-99` PowerShell tool with a
  default dry-run, future explicitly confirmed exact-99 initializer, and local
  read-only inspector. It uses one external fixed file, validates the encrypted
  temporary file before final rename, refuses overwrite, exposes no key or
  encrypted payload, creates no journal/checkpoint, and contains no RPC,
  signing, funding, or transaction path. The real store has not been created.
- A fixture-only exact-99 cumulative accumulation coordinator with fixed
  `5 -> 20 -> 50 -> 99` gates, exact per-gate fixture authorization, sequential
  per-wallet operation ordering, shared-journal idempotency, stop-on-first-error
  behavior, forward-only running stages, and a hard transition to
  `awaiting-manual-100` after index 98. It is not a public-network runner.
- A fixture-only exact-99 cumulative execution runner core with a narrow
  injected adapter, manifest-derived operation identities, receipt plus
  semantic reconciliation, restart idempotency, one-wallet-at-a-time ordering,
  and explicit 99/100 race checks. No Base Sepolia adapter exists.
- A fixture-only exact-99 public execution protocol v1 with a checksummed
  append-only journal v2, forward-only attempt states, explicit nonce and fee
  guards, dual-source block evidence, configurable finality/reorg handling,
  deterministic recovery decisions, global-run-lock concurrency model, and a
  separate `boundary-99` gate for index 98. It has no provider, signer,
  endpoint, signing implementation or broadcast transport.
- A fixture-only exact-99 wallet-store v2 prototype with 99 independently
  encrypted records and selected-index decryption. It is a format and isolation
  experiment only; no real wallet or store was created.
- A separate, guarded Base Sepolia single-wallet smoke harness with a default
  read-only preflight, dedicated runtime-only key namespace, fixed documented
  addresses, exact approval, reversible join/withdraw scope, buffered gas
  checks, 180-second receipts, bounded semantic read retries, stable journal IDs
  and conservative restart recovery. A controlled recovery reused the original
  journal, revalidated and skipped its previously confirmed faucet and exact
  approval, then broadcast only one join and one withdrawal. Position 3 was
  refunded exactly 33 dUSDC; the verified final state is 330 dUSDC, zero
  allowance, no active position, an Open pool with zero participants and zero
  escrow, and no pending transaction. This is the successful resumed Base
  Sepolia reversible smoke test; it does not enable the multi-wallet operator.
- The actual deployment register, verified source settings, and current
  technical frontend runbooks in `docs/DEMO_V1.md`.
- Separate `#/demo-v1` and `#/archive-v1` routes with isolated environment
  variables, ABI, data reads, guarded transaction actions, and domain tests.
- The `#/demo-v1` write path now rejects any non-canonical contract, token, or
  chain configuration and revalidates deployed bytecode, `paymentToken()`
  linkage, token identity, and fixed Demo V1 parameters before every wallet
  request.
- A synchronous single-flight guard covers the complete public faucet,
  approval/join, withdrawal, draw, or claim flow. Writes are simulated and
  never retried automatically; receipts have a 180-second timeout and explicit
  rejected, replaced, cancelled, and manual-review outcomes.
- The public approval/join path uses an exact 33 dUSDC allowance, waits for the
  approval receipt and a fresh exact allowance read, rechecks the selected Open
  pool, exact escrow, per-pool membership, user limit, token balance, and native
  gas, and only then requests the separate join signature. It supports the full
  `0 -> 100` fill range; there is no longer a reversible-test cap at 90.
- Faucet, join, and withdrawal receipts receive bounded read-only semantic
  verification. Join follows the actual `PositionJoined` pool and position even
  if allocation changed after preflight. Joins 1-99 must leave that pool Open;
  the 100th must produce exactly 100 positions, 3,300 dUSDC escrow, `Locked`,
  non-zero `lockedAt`, and all ten scheduled rounds. Withdrawal verifies the
  inactive position, exact 33 dUSDC refund, membership, and escrow.
- A public Vercel Preview for `codex/pop33-recovery`. Its landing page and both
  Demo V1 routes were manually verified read-only at commit `9b51afc`; at
  deployment commit `e64c689`, `/#/demo-v1` also passed one controlled exact
  approval, join, and Open-pool withdrawal with semantic post-receipt checks.

## Partial / in progress

- alignment of the demo with the intended mainnet product architecture;
- consistent configuration across UI, hooks, and environment variables;
- production randomness and asynchronous request/fulfillment recovery;
- manual public faucet verification through the Vercel Preview UI; the tested
  wallet already held 330 dUSDC, so faucet was not used in the successful
  approval, join, and withdrawal session;
- manual public draw and claim verification through the Vercel Preview UI;
- a complete public UI lifecycle with 100 positions, pool locking, ten draws,
  and ten claims; the frontend now supports and verifies the locking join, but
  that complete public lifecycle has not yet been executed;
- semantic post-receipt verification for draw and claim, at the same safety
  level now used for faucet, join, and withdrawal;
- confirmation, retention, and independent encrypted backup of the completed
  five-wallet pilot store, manifest, checkpoint, and journal recovery unit;
- later separately authorized implementation review and real creation/backup
  ceremony for a production-strength per-wallet encrypted 99-wallet store,
  followed by a public adapter, aggregate dry-run, and staged
  `5 -> 20 -> 50 -> 98 normal -> boundary-99` accumulation; the completed
  five-wallet pilot store must not be reused for that stage;
- the manually confirmed 100th public join, ten scheduled draw executions, ten
  winner claims, and final `Finished` reconciliation on Base Sepolia;
- promotion or release of the current Demo V1 through Vercel Production; the
  confirmed Preview must remain separate until a later explicit decision;
- selection of an external test-token address remains open only for the
  preserved alternative deployment path;
- unified cycle and position domain model;
- Farcaster integration;
- production readiness.

## Not implemented

- production stablecoin payment flow;
- production randomness, automated triggering, KYC/compliance, sponsored gas,
  and a backend event indexer.

## Legacy or alternative code retained

- `src/store/cyclesStore.ts`;
- `src/mock/mockService.ts`;
- `src/features/cycles/*`;
- compatibility fields in `src/types/core.ts`.

These files are retained intentionally. They must not be deleted solely because
newer code exists.

## Known inconsistencies and risks

- several incompatible cycle models exist in parallel;
- prototype participant and draw limits conflict across files;
- entry amounts conflict across documentation, UI copy, and configuration;
- the canonical active `Pop33DemoV2` deployment on Base Sepolia is configured
  through `VITE_POP33_CONTRACT_ADDRESS`; missing and invalid values disable
  contract reads and writes with an explicit availability state;
- `VITE_POP33_ENTRY_VALUE_WEI` is consumed but absent from `.env.example`;
- the Base Sepolia `POP IT` action is separated from local simulation state,
  but complete contract-side enforcement of the approved 10-position limit
  and lifecycle cannot be verified from the available ABI without contract
  source;
- the current contract join is nonpayable;
- the separate Demo V1 UI stops receipt waiting after 180 seconds and treats
  replacement, cancellation, and timeout conservatively, but it has no durable
  browser journal across page reloads; the transaction hash must be reviewed
  manually before deciding whether another write is safe;
- the separate Demo V1 route can request a switch to Base Sepolia and rechecks
  the live connector chain immediately before every write; wallet support and
  user confirmation are still required;
- withdrawal/refund behavior remains absent from the legacy deployment, while
  the separate Demo V1 route implements and post-verifies Open-pool withdrawal;
- some visible strings show character-encoding problems;
- the root frontend has focused domain tests, but a broader component and
  browser integration testing strategy remains `TO DECIDE`;
- source for the preserved legacy demo deployment is not present in this
  repository; the current deployed Demo V1 sources are in `packages/contracts`
  and are verified in BaseScan;
- the preserved external-token deployment script cannot determine whether a
  technically valid six-decimal address is product-approved; it still requires
  explicit human review;
- dUSDC's cooldown is per address, not per person, and is bypassable with
  multiple wallets; its faucet supply is intentionally uncapped and must never
  be represented as money or official Circle test USDC;
- dUSDC does not sponsor gas: every faucet and POP33 write still requires Base
  Sepolia ETH. Paymaster/sponsorship is a separate future milestone;
- the deployed Demo V1 contract's temporary draw entropy uses caller and block
  attributes and can be biased; it is suitable only for lifecycle tests and
  must be replaced by a verified randomness flow before production;
- claim expiry and alternate unclaimed-prize settlement remain `TO DECIDE`, so
  the current narrow implementation cannot reach `Finished` until all ten
  winners claim.
- the durable wallet and journal foundation is implemented, while the runnable
  local lifecycle deliberately keeps disposable in-memory wallets because its
  simulated chain also disappears. The public operator entrypoint is strictly
  read-only and requires an already-existing store, checkpoint, and journal;
  it cannot create them or broadcast Base Sepolia writes.
- provider-standard hash and nonce recovery is implemented conservatively. The
  smoke adapter also scans a bounded 128-block window for mined same-nonce
  replacements or cancellations. A pending replacement absent from standard
  RPC indexing remains a manual-review case.
- the current `join()` ABI cannot atomically bind a transaction to an expected
  pool ID and pre-join count. Post-receipt position/event validation detects a
  race but cannot undo it; a public-safe solution requires a future guarded
  contract entry point and separately reviewed deployment.
- the operator cannot make a Locked pool recoverable: the contract has neither
  participant withdrawal nor an administrator rescue path after the 100th join.
- an additional root-package `npm audit --omit=dev` reports 38 transitive
  frontend dependency findings (27 moderate, 11 high), primarily through the
  wallet connector stack; npm's complete remediation currently requires the
  breaking `wagmi` 2-to-3 upgrade. That frontend dependency migration is
  outside this contract-only checkpoint and remains to be planned and tested.

The previous wrong-network false positive was caused by using `useChainId()`
with a wagmi configuration containing only Base Sepolia. An unsupported active
connector network could therefore be represented as the configured chain. The
Base Sepolia action now uses the actual connector account chain reactively in
the UI and rechecks the connector directly before sending.

## Open decisions

- Basic V1 uses USDC, 33 USDC per position, 100 positions, and ten 330 USDC
  prizes with no fees.
- Demo V1 uses deployed own dUSDC recorded in `docs/DEMO_V1.md`. `TO DECIDE`: exact
  external Base Sepolia test-USDC address if the alternative path is selected.
- Basic V1 uses at most 10 open pools; `join()` selects the oldest qualifying
  pool and opens another only when no existing pool qualifies.
- A wallet may re-enter the same still-open pool after withdrawal, receiving a
  new globally unique position ID.
- `TO DECIDE`: exact randomness provider and failure recovery; Chainlink VRF is
  deferred for future analysis.
- Basic V1 uses pull-based claim accounting; claim expiry and unclaimed-prize
  settlement remain `TO DECIDE`.
- `TO DECIDE`: authorized automation versus safe permissionless triggering and
  possible Chainlink Automation use.
- Every current pool snapshots the approved Basic V1 constants and draw
  interval at creation. `TO DECIDE`: controlled versioned configuration for
  future price levels, restricted to subsequently created pools.
- The Basic V1 contract workspace is `packages/contracts`; release and deployed
  versioning policy remains `TO DECIDE`.
- `TO DECIDE`: broader component, browser integration, and end-to-end testing
  strategy beyond the existing automated frontend domain and contract suites.
- `TO DECIDE`: production, security, and compliance milestones.

## Verification commands

- `cd packages/contracts && npm run compile`
- `cd packages/contracts && npm test`
- `cd packages/contracts && npm run deploy:dry-run`
- `cd packages/contracts && npm run smoke:demo-v1`
- `cd packages/contracts && npm run operator:local:lifecycle`
- `cd packages/contracts && npm run smoke:base-sepolia` (external read-only RPC;
  requires dedicated public configuration and was not run in this milestone)
- `cd packages/contracts && npm run operator:base-sepolia:read-only -- preflight --wallet-count 2`
- `cd packages/contracts && npm run operator:base-sepolia:read-only -- dry-run --start-index 0 --wallet-count 5`
- `cd packages/contracts && npx tsc --noEmit`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

The root `npm test` command covers Demo V1 formatting and action-eligibility
domain logic. Broader frontend testing remains `TO DECIDE`.
