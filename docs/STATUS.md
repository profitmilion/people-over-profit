# POP33 Development Status

Last reviewed: 2026-07-18

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
write was performed during deployment.

The source for both current Demo V1 contracts is now published as an exact
match in BaseScan and is also available as an exact creation/runtime match in
Sourcify. Before publication, the local sources were confirmed unchanged from
the deployment source commit, the compiler settings and constructor arguments
were reconstructed from build-info and artifacts, and the local runtime
bytecode matched the deployed bytecode after applying the recorded immutable
references. Source verification did not change the bytecode or blockchain
state and is not a security audit. The temporary testnet randomness remains
manipulable, and the complete 100-wallet lifecycle has not been executed.

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

Production remains separate and does not host the current Demo V1 checkpoint.
Farcaster is not implemented and is not required by this standalone Web3
runtime.

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
- Automated contract/operator coverage: 167 passing Mocha tests, including 29
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
  checks, 180-second receipts, bounded semantic read retries, stable journal IDs
  and conservative restart recovery. A controlled recovery reused the original
  journal, revalidated and skipped its previously confirmed faucet and exact
  approval, then broadcast only one join and one withdrawal. Position 3 was
  refunded exactly 33 dUSDC; the verified final state is 330 dUSDC, zero
  allowance, no active position, an Open pool with zero participants and zero
  escrow, and no pending transaction. This is the successful resumed Base
  Sepolia reversible smoke test; it does not enable the multi-wallet operator.
- A planned deployment register and a technical frontend integration plan in
  `docs/DEMO_V1.md`.
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
  pool and user limit, and only then requests the separate join signature. For
  the reversible UI test it refuses pools above 89 active positions.
- Faucet, join, and withdrawal receipts receive bounded read-only semantic
  verification. Join reports the actual position and pool and reconciles the
  exact payment, allowance, membership, and escrow; withdrawal verifies the
  inactive position, exact 33 dUSDC refund, membership, and escrow.
- A public Vercel Preview for `codex/pop33-recovery`. Its landing page and both
  Demo V1 routes were manually verified read-only at commit `9b51afc`; at
  deployment commit `e64c689`, `/#/demo-v1` also passed one controlled exact
  approval, join, and Open-pool withdrawal with semantic post-receipt checks.

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
- manual public faucet verification through the Vercel Preview UI; the tested
  wallet already held 330 dUSDC, so faucet was not used in the successful
  approval, join, and withdrawal session;
- manual public draw and claim verification through the Vercel Preview UI;
- a complete public UI lifecycle with 100 positions, pool locking, ten draws,
  and ten claims;
- promotion or release of the current Demo V1 through Vercel Production; the
  confirmed Preview must remain separate until a later explicit decision;
- selection of an external test-token address remains open only for the
  preserved alternative deployment path;
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
- the separate Demo V1 UI stops receipt waiting after 180 seconds and treats
  replacement, cancellation, and timeout conservatively, but it has no durable
  browser journal across page reloads; the transaction hash must be reviewed
  manually before deciding whether another write is safe;
- the separate Demo V1 route can request a switch to Base Sepolia and rechecks
  the live connector chain immediately before every write; wallet support and
  user confirmation are still required;
- withdrawal/refund behavior remains absent from the legacy deployment, while
  the separate Demo V1 route implements and post-verifies Open-pool withdrawal;
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
