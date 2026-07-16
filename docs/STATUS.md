# POP33 Development Status

Last reviewed: 2026-07-16

Branch reviewed: `codex/pop33-recovery`

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
available on their original routes and configuration.

The controlled Demo V1 pair is now deployed on Base Sepolia. It
includes the POP33-owned, six-decimal POP33 Demo USD (`dUSDC`) faucet token and
keeps the existing external-token deployment variant separate. The new pair
path validates environment values, chain ID, conservative deployer gas reserves,
two independent confirmations, deployed bytecode, fixed faucet parameters, and
the linkage between dUSDC and `Pop33BasicV1`. Local commands deploy the same
pair and exercise the faucet through the full lifecycle. Runtime bytecode,
creation inputs, getters, constructor linkage, and the empty initial pool were
verified on-chain. One faucet drip was tested; no approve or POP33 lifecycle
write was performed during deployment. Source publication in BaseScan is
pending. A separate local `#/demo-v1` integration now targets the new ABI and
addresses; it has not been released through Vercel.

## Business-rule implementation matrix

| Approved rule | Implementation status | Notes |
| --- | --- | --- |
| One payment creates one position in a specific pool/cycle | **implemented in deployed Demo V1 and local frontend** | `Pop33BasicV1` transfers exactly 33 dUSDC with `SafeERC20`; the separate UI performs an exact approval and then `join()`. |
| One primary participation action creates one position per successful use | **partial** | In `/demo`, `POP IT` now invokes only the Base Sepolia transaction and does not mutate local simulation state. The current contract join remains nonpayable, so the approved payment flow is still absent. |
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
| Demo mirrors the final/mainnet product model | **partial** | The `/demo` participation action is now Base Sepolia-only, while the browser-local simulation is confined to `/demo?view=dev`. Stablecoin payment, withdrawals, and complete authoritative position lifecycle rules remain missing. |
| Demo differences limited mainly to network, test tokens, safety parameters, and developer tools | **partial** | This is the approved direction; the current historical simulation and unfinished contract integration have not yet fully converged on it. |

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
- On-chain `openNextAndJoin()` transaction call.
- Basic on-chain aggregate and per-wallet reads.
- Transaction pending, confirmation, and error states.
- Separation of the Base Sepolia `POP IT` action from browser-local simulation
  state.
- A synchronous single-intent guard covering wallet approval, submission, and
  confirmation to prevent rapid duplicate transaction requests.
- Wallet network readiness is derived from the active connector account chain,
  with a second `connector.getChainId()` check immediately before
  `writeContractAsync`; unsupported networks cannot open a transaction request.
- Local cycle presentation and controls confined to `/demo?view=dev` and
  explicitly labelled as non-on-chain developer simulation.
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
- Automated contract/operator coverage: 163 passing Mocha tests, including 25
  isolated Base Sepolia smoke-harness tests. No test uses a public RPC.
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
- A separate, guarded Base Sepolia single-wallet smoke harness with a default
  read-only preflight, dedicated runtime-only key namespace, fixed documented
  addresses, exact approval, reversible join/withdraw scope, buffered gas
  checks, 180-second receipts, bounded read retries, stable journal IDs and
  conservative restart recovery. Its write mode was not executed in this
  milestone because no dedicated smoke runtime configuration was present.
- A planned deployment register and a technical frontend integration plan in
  `docs/DEMO_V1.md`.
- Separate `#/demo-v1` and `#/archive-v1` routes with isolated environment
  variables, ABI, data reads, guarded transaction actions, and domain tests.

## Partial / in progress

- alignment of the demo with the intended mainnet product architecture;
- expansion of the authoritative on-chain user view beyond the currently
  available aggregate, cycle ID, and active-cycle count reads;
- contract-driven pool lifecycle;
- authoritative on-chain enforcement of the 10-active-position limit;
- authoritative on-chain enforcement of automatic allocation, one position per
  user per pool, and the active-position lifecycle;
- consistent configuration across UI, hooks, and environment variables;
- production randomness and asynchronous request/fulfillment recovery;
- actual deployment and independent recording of both dUSDC and Pop33 Base
  Sepolia addresses; selection of an external test-token address remains open
  only for the preserved alternative deployment path;
- source publication for the recorded Base Sepolia deployment;
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
- a transaction that remains pending for a very long time can keep the primary
  action locked until a receipt or provider error is observed;
- handling for replaced or cancelled transactions and controlled recovery from
  prolonged pending state is not yet implemented;
- automatic wallet network switching is not implemented; users must switch to
  Base Sepolia explicitly in their wallet;
- withdrawal/refund behavior is absent;
- the README contains historical and Vite-template content;
- some visible strings show character-encoding problems;
- the root frontend has focused domain tests, but a broader component and
  browser integration testing strategy remains `TO DECIDE`;
- source for the currently deployed demo contract is not present; source for
the new, deployed Demo V1 Basic foundation is in `packages/contracts`.
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
- the durable wallet and journal foundation is implemented, but the runnable
  local lifecycle deliberately keeps disposable in-memory wallets because its
  simulated chain also disappears. No public operator entrypoint exists;
  Base Sepolia writes remain blocked before broadcast.
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
- `TO DECIDE`: testing strategy.
- `TO DECIDE`: production, security, and compliance milestones.

## Verification commands

- `cd packages/contracts && npm run compile`
- `cd packages/contracts && npm test`
- `cd packages/contracts && npm run deploy:dry-run`
- `cd packages/contracts && npm run smoke:demo-v1`
- `cd packages/contracts && npm run operator:local:lifecycle`
- `cd packages/contracts && npm run smoke:base-sepolia` (external read-only RPC;
  requires dedicated public configuration and was not run in this milestone)
- `cd packages/contracts && npx tsc --noEmit`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

The root `npm test` command covers Demo V1 formatting and action-eligibility
domain logic. Broader frontend testing remains `TO DECIDE`.
