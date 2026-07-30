# Base Sepolia exact-99 cumulative execution runner core

Status: fixture-only core and injected fixture adapter prepared; no public
network adapter

This runner must not be connected to Base Sepolia. Its empty-pool counters and
fixture snapshot model are not the source of truth for the current public
deployment. The separate read-only readiness plan supplies dynamic counts and
does not add a transaction adapter.

Prepared: 2026-07-27

## Simple purpose

The cumulative coordinator answers: “which manifest-bound wallet operation is
allowed next?” The runner core performs the next local fixture operation
through an injected adapter, checks its receipt and resulting semantic state,
and returns the result to the same coordinator, checkpoint, and append-only
journal.

The runner does not create a second checkpoint, journal, wallet list, or
operation identity. It accepts only the exact-99 manifest, funding plan, current
checkpoint authorization, and ordered indices `0-98`.

## Relationship to the two-wallet pilot

The completed public pilot established reusable safety principles:

- one wallet and one operation at a time;
- journal preparation before a transaction boundary;
- deterministic operation identity and forward-only status;
- no repeat of a confirmed operation;
- receipt timeout and ambiguous outcome as hard stops;
- receipt identity verification followed by semantic state reads; and
- sanitized errors plus explicit recovery review.

The exact-99 runner reuses those principles, the existing error sanitizer, and
the shared journal/checkpoint validators. It does not copy the pilot’s Ethers
runtime, RPC, nonce reservation, signer selection, five-wallet store, indices
0/1, pool #1 restriction, withdrawal step, or public transaction transport.
Those pieces are specific to the already completed pilot.

## Runner and adapter boundary

The runner exposes only local `plan`, `inspect`, and `simulate` modes. The
adapter interface has two narrow methods:

1. inspect the exact manifest-bound operation and provide a pre-operation
   fixture snapshot;
2. run that same fixture operation and return a structured result.

Results distinguish confirmation, failure, timeout before a hash, timeout
after a hash, pending, ambiguous, and manual-review. A confirmed result contains
the fixture hash, receipt, and operation-specific reconciliation evidence.

The included fixture adapter accepts injected local functions. It contains no
provider, signer, key loader, environment reader, RPC endpoint, or transaction
transport.

## Sequential operation order

For every wallet the runner accepts only:

`funding -> faucet -> approve -> join`

The wallet address, index, checkpoint, operation type, and operation ID come
from the exact-99 artifacts and coordinator. A caller cannot supply a different
wallet list. Confirmed operations and completed wallets are skipped on restart.
A partial wallet resumes at its first unfinished operation.

Range simulation invokes the adapter sequentially. The resulting fixture
outcomes are committed atomically through the existing coordinator once per
range, which avoids repeatedly revalidating the complete growing journal while
preserving stop-on-first-error behavior.

This atomic range path is only a fixture-test optimization and is not a pattern
for a public adapter. Any future public adapter must use the single-operation
runner path and durably persist the checkpoint and journal after every
individual operation before proceeding to the next operation.

## Semantic reconciliation

A successful fixture receipt is necessary but not sufficient.

### Funding

The address and amount must match the funding plan. The amount cannot exceed
the per-wallet maximum, and the native-balance delta must equal the planned
amount.

### Faucet

The public wallet and operation ID must match. The reported dUSDC increase and
received amount must equal the approved fixture drip amount.

### Approve

The wallet and operation ID must match. Token and spender must equal the
manifest addresses, and the final allowance must be sufficient for one entry.

### Join

The runner requires matching before/after pool snapshots, the expected wallet,
operation ID and pool, exactly one new active position, a one-step participant
increase, unchanged cycle identity, an Open and unlocked pool, and the expected
runner join counters. Any receipt without this evidence becomes ambiguous and
stops the range.

## Boundary 99/100

Before every join the fixture snapshot includes:

- pool and cycle identity;
- pool status;
- active position count;
- expected next position index;
- lock flag; and
- `lockedAt`.

The pre-join count must equal the runner’s confirmed join count. This detects an
external join before submission. The after snapshot must increase by exactly
one without changing cycle or locking early. An external join between snapshots,
an unexpected count, an early lock, or a changed cycle produces a blocking
result.

The last automatic wallet is index `98`. Its successful join leaves exactly 99
positions and moves the checkpoint to `awaiting-manual-100`. The runner has no
automatic identity or operation for index `99` and no manual-100 implementation.

This remains the behavior of the existing fixture runner for compatibility.
It is not the future public boundary policy. Public execution protocol v1,
documented in
`docs/RUNBOOK_BASE_SEPOLIA_EXACT_99_PUBLIC_EXECUTION_PROTOCOL.md`, ends its
normal path at index `97` and handles index `98` only through the separately
authorized, fresh, one-use `boundary-99` gate. No existing fixture artifact is
silently migrated.

## Restart and recovery

Every fresh runner invocation performs the complete local artifact and
coordinator preflight. It refuses pending, ambiguous, failed, or manual-review
state. Confirmed operation IDs and hashes are preserved. A known-hash timeout
remains pending; a timeout before a hash requires manual review because the
submission outcome cannot be proven.

Continuing a later checkpoint requires its own exact fixture authorization
phrase. Authorization for one checkpoint cannot start another.

## Current authorization boundary

This milestone is fixture-only. It did not create a real wallet store, wallets,
signer, manifest, checkpoint, journal, or funding-plan artifact. It did not read
an environment secret, connect to Base Sepolia, send ETH, or perform faucet,
approve, join, withdrawal, draw, or claim transactions.

The fixture-only public execution protocol and journal v2 are now specified in
`docs/RUNBOOK_BASE_SEPOLIA_EXACT_99_PUBLIC_EXECUTION_PROTOCOL.md`. A real Base
Sepolia adapter remains a separate future design and authorization.
