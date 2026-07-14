# POP33 Basic V1 Specification

## Document status

This document defines the approved target behavior for the POP33 Basic V1
testnet product. It is a product and architecture specification, not a claim
that the current contract or frontend already implements the behavior.

Where this document conflicts with older descriptions of one winner receiving
an entire pool, this document takes precedence. Basic V1 has 10 separate draw
rounds and 10 different winning positions.

Unresolved implementation or product matters are marked `TO DECIDE`.

## Basic V1 parameters

- Network for the first deployment: Base Sepolia.
- Payment asset: a previously verified, standard, non-rebasing USDC-compatible
  ERC-20 with exactly 6 decimals. Fee-on-transfer and non-standard ERC-20
  behavior are not supported.
- Exact Base Sepolia USDC contract address: `TO DECIDE`.
- Price per position: 33 USDC.
- Positions per full pool: 100.
- Maximum simultaneously open pools: 10.
- Total collected by a full pool: 3,300 USDC.
- Draw rounds per full pool: 10.
- Winners per round: exactly 1.
- Prize per round: 330 USDC.
- Total prizes per full pool: 3,300 USDC.
- Fees and other deductions in Basic V1: none.
- Winning positions per full pool: exactly 10 different positions.
- Draw interval configured for Base Sepolia: 1 hour.
- Planned draw interval for a future mainnet deployment: 24 hours.

The draw interval must be an immutable deployment parameter or another
explicitly controlled configuration value. Changing the network must not
silently change the interval or any economic parameter.

The undeployed Basic V1 workspace stores an immutable snapshot in every pool
for the entry price, position capacity, draw-round count, prize per round,
total prize amount, and draw interval. The current contract has no runtime
configuration setter: all newly created pools use the approved 33 USDC Basic
V1 defaults. A future controlled configuration mechanism may change defaults
only for pools created after that change; it must never mutate an existing
pool, including an `Open` pool that already contains positions.

## Participation and position rules

1. One successful payment of 33 USDC creates one position.
2. The system assigns the position to an appropriate open pool. The user does
   not manually select a pool.
3. One wallet may hold at most one position in the same pool.
4. One wallet may hold at most 10 active positions across different pools.
5. A position is active from successful creation until either:
   - it is withdrawn while its pool is `Open`; or
   - its pool correctly reaches `Finished`.
6. Reaching `Locked`, starting or completing a draw round, reaching
   `Claimable`, winning, or claiming an individual prize does not by itself
   release a position from the active-position limit.
7. After withdrawing from an `Open` pool, the same wallet may join that pool
   again. A successful re-entry creates a new globally unique position ID; the
   withdrawn position remains inactive and is never reused.

## Automatic pool allocation

`join()` selects the oldest open pool, ordered by pool ID/creation order, in
which the wallet has no active position. A new pool is created only when no
existing open pool qualifies the wallet and fewer than 10 pools are open.
The open-pool index is bounded to 10 entries and preserves oldest-to-newest
order when a pool is removed at lock.

## Pool lifecycle

The target lifecycle is:

`Open -> Locked -> Drawing -> Claimable -> Finished`

### Open

- The pool accepts positions until it contains 100 positions.
- A wallet may withdraw its own position.
- A successful withdrawal removes the position, returns its 33 USDC, and
  releases one slot from the wallet's active-position limit.
- Pool funds may only move as part of a valid withdrawal of an existing
  position.

### Locked

- The 100th successful position atomically changes the pool from `Open` to
  `Locked` and records `lockedAt`.
- The pool holds exactly 3,300 USDC reserved for its 10 prizes.
- New positions and withdrawals are prohibited.
- No position funds may be refunded, released, reassigned, or counted as
  inactive.
- The first draw round becomes eligible at `lockedAt + drawInterval`.

### Drawing

- The pool enters `Drawing` when the first eligible draw-round request is
  initiated.
- Ten rounds are resolved sequentially.
- Round `n`, where `n` is from 1 through 10, is scheduled for
  `lockedAt + n * drawInterval`.
- A later transaction may execute after its scheduled time; missed time does
  not invalidate the pool or allow multiple rounds to be executed as one
  round.
- A completed round credits 330 USDC to its winner's claimable balance.
- Winners from completed rounds may claim while later rounds are still
  pending, once claim is implemented.
- Claiming does not change the active status of the winner's position.

### Claimable

- All 10 draw results have been finalized.
- Some prizes may still be awaiting claim or other approved settlement.
- All pool positions remain active.
- No participant withdrawal or refund is allowed.

### Finished

- All 10 rounds have been finalized.
- All 10 prizes have been settled under the approved claim and unclaimed-prize
  rules.
- Only this transition releases the pool's positions from the active-position
  limit.

Claim expiry, treatment of unclaimed prizes, and the exact finalization
operation are `TO DECIDE`. The implementation must not reach `Finished` merely
because the tenth winner was selected.

Until an expiry or alternative settlement rule is approved, the current
undeployed implementation uses the narrow safe finalization rule: the pool
enters `Finished` only after all 10 finalized round prizes have been claimed.
The final claim atomically releases all 100 positions from active-position
accounting. This is an implementation constraint for the present stage, not a
decision about future claim expiry or unclaimed-prize treatment.

## Draw and winner rules

1. Each full pool has exactly 10 draw rounds.
2. Each round selects exactly one winning position and its wallet.
3. A winning position is removed from the candidate set for all later rounds
   in the same pool.
4. Because a wallet may own only one position in a pool, the pool produces 10
   different winning wallets.
5. Each completed round assigns exactly 330 USDC to its winner.
6. The contract must preserve the invariant that total prizes assigned by a
   pool cannot exceed 3,300 USDC.
7. Prizes use a pull-based claim model. The contract must not automatically
   transfer the prize as part of randomness fulfillment.

Basic V1 does not have one winner receiving the entire 3,300 USDC pool.

## Round record

Each pool must expose or make reconstructable for rounds 1 through 10:

- round number;
- scheduled execution time;
- actual request and/or completion time;
- round status;
- winning position identifier;
- winning wallet address;
- prize amount of 330 USDC;
- randomness request identifier;
- whether the prize has been claimed or otherwise settled;
- data sufficient to associate request, completion, and claim events with
  their transactions.

A contract cannot read the hash of its currently executing transaction.
Transaction hashes must therefore be obtained from transaction receipts,
events, an explorer, or an indexer. Round events should include at least the
pool ID, round number, and randomness request ID so that the association is
unambiguous.

## Draw triggering and timing invariants

Time passing alone does not execute a smart-contract function. The architecture
must permit the next round to be initiated either by authorized automation or
by a public, permissionless function that is safe for any address to call.
The exact trigger policy is `TO DECIDE`.

Regardless of the caller, initiation must revert unless all of the following
are true:

- the pool is `Locked` or `Drawing` as appropriate;
- the round's scheduled time has passed;
- the preceding round has been finalized, except for round 1;
- fewer than 10 rounds have been finalized;
- the current round has not already been finalized;
- no randomness request is active for the current round.

The design must prevent duplicate requests and duplicate fulfillment for one
round. Randomness fulfillment must be correlated with the expected pool,
round, and active request ID before any result is accepted.

### Temporary lifecycle-testing draw mechanism

The current undeployed workspace exposes a permissionless `executeDraw(poolId,
roundNumber)` function so the full lifecycle can be tested before VRF and
Automation are selected. It executes one eligible round synchronously, assigns
a monotonically increasing temporary request ID, and selects one position from
a bounded remaining-candidate array with constant-time swap-and-pop removal.
The first call changes `Locked` to `Drawing`; the tenth finalized call changes
`Drawing` to `Claimable`.

This temporary selection is **not production-safe randomness**. Its entropy
uses current block attributes and the caller, all of which may be predicted or
influenced. A validator, transaction submitter, or ordering actor may bias a
result. Temporary request IDs are local correlation identifiers, not Chainlink
VRF request IDs, and there is no asynchronous request state in this mechanism.
It must be replaced, not relabelled, before a production deployment.

## Open/Locked contract core design

The first implementation stage may implement only participation, withdrawal,
and the `Open -> Locked` transition, but its storage and invariants must remain
compatible with the later 10-round lifecycle.

At minimum, the core model should reserve:

- a unique pool ID;
- a pool status enum containing all five target states;
- `positionCount`, `openedAt`, `lockedAt`, and `drawInterval`;
- the pool's position identifiers and wallet membership lookup;
- a bounded active candidate set containing at most 100 position identifiers
  per pool, with constant-time removal during an `Open` withdrawal;
- per-wallet active-position accounting;
- the amount of USDC held for the pool;
- future round progress such as completed-round count and active randomness
  request state, without implementing randomness in the current stage;
- per-round records or an unambiguous future storage extension for 10 records;
- per-winner claimable accounting as a later extension.

Required Open/Locked invariants include:

- a position is created only after the contract receives exactly 33 USDC;
- one wallet cannot create a second position in the same pool;
- a wallet with 10 active positions cannot create another position;
- only the position owner may withdraw it;
- withdrawal is possible only while the pool is `Open`;
- withdrawal returns exactly 33 USDC in Basic V1 and updates state atomically;
- the 100th position changes the pool to `Locked` in the same transaction;
- a locked pool contains 100 positions and accounts for 3,300 USDC;
- no withdrawal, refund, prize transfer, fee transfer, or active-position
  release is possible from the Open/Locked core after `Locked`;
- opening or using a subsequent pool cannot mutate the funds or positions of a
  locked pool.
- the active candidate set contains exactly 100 unique active positions when a
  pool becomes `Locked` and remains stable after lock;
- direct token transfers may make the raw token balance exceed accounted
  escrow, but must not change `totalEscrowed` or any pool's escrow accounting.

Chronological join and withdrawal history is reconstructed primarily from
events. The contract is not required to retain an unbounded per-pool history
array. The global position mapping keeps each created position ID and its final
active/inactive state.

The core must use checks-effects-interactions, safe ERC-20 transfer handling,
and reentrancy protection where external token calls can occur. Exact library,
pause, administration, and upgrade choices are `TO DECIDE`.

## Deferred integrations

The following are explicitly outside the current implementation stage:

- Chainlink VRF integration;
- Chainlink Automation registration;
- production-grade winner selection;
- asynchronous randomness request, correlation, fulfillment, retry, and
  failure-recovery implementation;
- deployment.

A future stage must evaluate Chainlink VRF for verifiable randomness and
Chainlink Automation for scheduled round initiation. Neither product is assumed
to be approved merely by being named here.

## Events required by the target architecture

Final names are implementation details, but the event model must make these
facts indexable:

- pool opened;
- position created;
- position withdrawn and refunded;
- pool locked with `lockedAt`, draw interval, active-position count, and pool
  escrow;
- draw round requested;
- draw round finalized with winner and prize;
- prize claimed;
- pool entered `Claimable`;
- pool finished.

## Matters still to decide

- exact Base Sepolia test USDC address and faucet/distribution process;
- handling of incomplete or stalled open pools;
- Chainlink VRF version, subscription/funding model, and failure recovery;
- authorized automation versus permissionless triggering, including incentives;
- claim expiry and treatment of unclaimed prizes;
- emergency pause, administration, multisig, and upgrade policy;
- mainnet deployment parameters and release criteria;
- indexing architecture for the public archive;
- legal, eligibility, geographic, and compliance requirements.
