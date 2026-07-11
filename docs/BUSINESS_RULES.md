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

The stablecoin, price per position, payment details, final user-facing name for
a `position`, and exact automatic pool-allocation algorithm are `TO DECIDE`.

### Active-position lifecycle

A position ceases to count toward the global limit of 10 only when:

1. the user withdraws it from an open and unlocked pool; or
2. its pool completes the entire approved draw process and reaches `finished`
   status.

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

The target participant count and handling of stalled pools are `TO DECIDE`.

### Withdrawal before pool lock

Withdrawing one position from an open pool must:

1. remove that participant position from the pool;
2. release one active-position slot in the user's limit of 10;
3. return the stablecoin paid for that position.

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
- the current UI may perform a local join and an on-chain join from the same
  action;
- no withdrawal/refund operation is present in the inspected UI or contract
  ABI.

## Conflicting prototype values

Current sources contain incompatible prototype values for:

- cycle capacity: 10, 30, or 100;
- maximum draws: 3 or 30;
- entry amounts: several values are referenced in different contexts;
- lifecycle status names and state models;
- network labels across configuration and UI copy.

These conflicts do not modify the approved rules. Their final values remain
`TO DECIDE`.

## Decisions required

### Participation and payments

- `TO DECIDE`: supported stablecoin.
- `TO DECIDE`: payment amount per position.
- `TO DECIDE`: whether positions may be transferred.
- `TO DECIDE`: final user-facing name for a `position`.
- `TO DECIDE`: eligibility, geography, and age requirements.

### Pools

- `TO DECIDE`: target participant count.
- `TO DECIDE`: pool creation policy.
- `TO DECIDE`: number of simultaneously open pools.
- `TO DECIDE`: exact automatic pool-allocation algorithm and its authoritative
  on-chain enforcement.
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
- `TO DECIDE`: draw schedule.
- `TO DECIDE`: draws per pool.
- `TO DECIDE`: winners per draw.
- `TO DECIDE`: whether one position can win more than once.
- `TO DECIDE`: prize calculation and payout process.
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
