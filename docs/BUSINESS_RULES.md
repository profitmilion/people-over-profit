# POP33 Business Rules

## Document status

This document separates approved business rules from observed prototype
behavior and unresolved decisions. Current implementation behavior is not
automatically an approved business rule.

## Approved rules

### Positions and payments

1. The user participates through one primary participation action.
2. One successful use of that action and one user payment create one position.
3. The system automatically assigns the position to an appropriate open
   pool/cycle. The user does not manually select a pool.
4. If no appropriate open pool exists, the system may open the next pool in
   accordance with system limits.
5. One user or wallet may hold at most one active position in the same pool.
6. A subsequent position from the same user must be assigned to another
   appropriate pool.
7. A user may have at most 10 active positions at the same time.
8. Each active position counts separately toward this limit.
9. Subsequent successful uses of the primary action create subsequent positions
   until the limit is reached.
10. Once the user has 10 active positions, creation of another position is
    blocked.
11. Creation becomes available again when at least one position ceases to be
    active.

For Basic V1, the payment asset is a previously verified, standard,
non-rebasing 6-decimal USDC-compatible ERC-20 and one position costs 33 USDC.
The exact Base Sepolia test USDC address, final user-facing name for a
`position`, and payment integration details are `TO DECIDE`.

Basic V1 may have at most 10 simultaneously open pools. `join()` selects the
oldest open pool in which the wallet has no active position and creates a new
pool only if no existing open pool qualifies. After withdrawal, the wallet may
re-enter the same pool while it remains open; re-entry creates a new unique
position ID and never reactivates the withdrawn record.

### Active-position lifecycle

A position ceases to count toward the global limit of 10 only when:

1. the user withdraws it from an open and unlocked pool; or
2. its pool completes the entire approved draw and prize-settlement process and
   reaches `finished` status.

The first draw alone does not release a position from the active-position
limit. A position remains active throughout the draw process until its pool
reaches `finished`.

### Pool collection and locking

1. Until a pool reaches its target participant count, it remains open and in
   the collection phase.
2. A participant may withdraw an individual position while its pool remains
   open.
3. When the pool reaches its target participant count, the pool becomes full
   and locked.
4. Once a pool is full and locked, withdrawal is not possible.

The Basic V1 target participant count is 100. Handling of stalled pools remains
`TO DECIDE`.

### Basic V1 draws and prizes

1. A full Basic V1 pool contains 100 positions funded with 33 USDC each, for a
   total of 3,300 USDC.
2. A full pool has 10 sequential draw rounds.
3. Each round selects exactly one winning position and assigns a prize of
   330 USDC.
4. A winning position is excluded from every later round in the same pool.
5. Because one wallet may hold only one position in a pool, a completed pool
   has 10 different winning wallets.
6. Basic V1 has no fees or deductions; its 10 prizes total 3,300 USDC.
7. Prizes use a claim model and are not transferred automatically during winner
   selection.
8. The Base Sepolia interval between scheduled rounds is 1 hour. The planned
   future mainnet interval is 24 hours. The interval must be configured for the
   deployment.
9. Time passing does not execute a draw. An authorized automation or a safe
   permissionless call may initiate an eligible round; the exact trigger policy
   is `TO DECIDE`.
10. A round cannot start before its scheduled time, before the preceding round
    is complete, while it already has an active randomness request, or after it
    has already been finalized.

The approved target lifecycle is
`Open -> Locked -> Drawing -> Claimable -> Finished`. `Locked` is entered by
the 100th position. Withdrawals and refunds are prohibited from `Locked`
onward. Positions remain active throughout `Locked`, `Drawing`, and
`Claimable`, and are released only when the pool correctly reaches `Finished`.
Detailed round records and the architecture constraints are defined in
`docs/BASIC_V1_SPEC.md`.

### Withdrawal before pool lock

Withdrawing one position from an open pool must:

1. remove that participant position from the pool;
2. release one active-position slot in the user's limit of 10;
3. return the stablecoin paid for that position.

Each pool's on-chain active-position candidate set is bounded to 100 entries.
Withdrawal removes an entry from that active set, while chronological history
is reconstructed from join and withdrawal events and globally unique position
records.

Refund transaction details, fees, and failure handling are `TO DECIDE`.

### Demo and mainnet alignment

1. The POP33 demo must mirror the final product and mainnet architecture as
   closely as practical.
2. Demo/testnet differences should be limited mainly to:
   - the test network instead of mainnet;
   - test tokens instead of real funds;
   - safety parameters;
   - additional developer tools.
3. The demo must not introduce different business logic or a disposable,
   completely simplified user flow that would later need to be rebuilt from
   scratch.
4. The local simulation is a developer tool and historical prototype layer,
   not a separate target business model.

## Observed implementation behavior

The following facts describe current code only and do not override the approved
rules above:

- the primary local simulation uses `open`, `drawing`, and `finished` states;
- a full locally simulated cycle moves into drawing;
- locally simulated winners do not repeat within one cycle;
- local state is persisted in browser local storage;
- the developer panel can add simulated participants, trigger a draw, and reset
  local demo data;
- the current Base Sepolia join function is nonpayable;
- the current main demo join is on-chain only, while local joins are confined
  to the developer simulation;
- no withdrawal/refund operation is present in the inspected UI or contract
  ABI.

## Conflicting prototype values

Current sources contain incompatible prototype values for:

- cycle capacity: 10, 30, or 100;
- maximum draws: 3 or 30;
- entry amounts: several values are referenced in different contexts;
- lifecycle status names and state models;
- network labels across configuration and UI copy.

These conflicting implementations are retained as historical or developer
layers and do not modify the approved rules. For Basic V1, the authoritative
target values are now 100 positions, 33 USDC per position, 10 draw rounds, and
the `Open -> Locked -> Drawing -> Claimable -> Finished` lifecycle. Legacy
values such as capacities of 10 or 30 and draw limits of 3 or 30 are not Basic
V1 product rules.

## Decisions required

### Participation and payments

- Basic V1 uses USDC at 33 USDC per position.
- `TO DECIDE`: exact Base Sepolia test USDC address.
- `TO DECIDE`: whether positions may be transferred.
- `TO DECIDE`: final user-facing name for a `position`.
- `TO DECIDE`: eligibility, geography, and age requirements.

### Pools

- Basic V1 target participant count is 100.
- Basic V1 permits at most 10 simultaneously open pools. The contract selects
  the oldest qualifying pool and creates a new one only when none qualifies.
- The undeployed `Pop33BasicV1` workspace enforces this allocation on-chain.
- `TO DECIDE`: behavior of incomplete or stalled pools.
- `TO DECIDE`: whether any cancellation path exists besides individual
  withdrawal from an open pool.

### Withdrawals and refunds

- `TO DECIDE`: whether withdrawal has a fee.
- `TO DECIDE`: transaction ordering and failure recovery.
- `TO DECIDE`: treatment of network fees.
- `TO DECIDE`: refund timing guarantees.

### Draws and winners

- `TO DECIDE`: randomness source and verification.
- Basic V1 uses 10 rounds, one winner and 330 USDC per round, with no repeated
  winning position in one pool.
- Basic V1 Base Sepolia rounds are scheduled hourly; the planned future
  mainnet interval is 24 hours.
- Basic V1 uses pull-based claims rather than automatic winner transfers.
- `TO DECIDE`: exact claim expiry and unclaimed-prize settlement rules.
- `TO DECIDE`: authorized automation or permissionless draw triggering and any
  caller incentive.
- `TO DECIDE`: failed draw and failed payout handling.

### Funds and allocation

- `TO DECIDE`: fund custody before and after pool lock.
- `TO DECIDE`: fee structure.
- `TO DECIDE`: prize-pool allocation.
- `TO DECIDE`: development and community allocation.
- `TO DECIDE`: reserve, Auto-HODL, DCA, and PMN mechanics.

### Governance, compliance, and security

- `TO DECIDE`: authoritative on-chain records and public reporting.
- `TO DECIDE`: governance rights and PMN utility.
- `TO DECIDE`: contract upgrade and emergency-control policy.
- `TO DECIDE`: legal classification and required legal review.
- `TO DECIDE`: KYC/AML requirements.
- `TO DECIDE`: audit requirements and incident response.
