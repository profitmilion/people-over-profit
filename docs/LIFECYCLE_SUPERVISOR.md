# POP33 read-only lifecycle supervisor

## For Piotr

The supervisor is a control panel without control buttons. It looks at every
pool in one fixed snapshot and says what should happen next: wait for
participants, wait for the next draw time, notice a due or overdue draw, wait
for winners to claim, or confirm that the pool is finished.

It cannot move funds or change the chain. It has no key, account, transaction
submission, deployment, Join, Withdraw, Draw, or Claim capability. A red result
means "inspect this state", not "the program will fix it".

## Scope

The implementation lives in the contract workspace but is separate from the
contract and transaction operators:

- `scripts/operator/lifecycle-supervisor.ts` is the deterministic decision
  engine and its data model;
- `scripts/operator/lifecycle-supervisor-fixtures.ts` is the read-only adapter
  boundary and deterministic fixture implementation;
- `scripts/lifecycle-supervisor.ts` and
  `scripts/lifecycle-supervisor-cli.mjs` form the CLI;
- `test/LifecycleSupervisor.test.ts` covers lifecycle, consistency, time,
  precision, filtering, and safety behavior.

The interface is intentionally small: it exposes a source label and one
`readSnapshot()` method. It now has a deterministic fixture implementation and
a Base Sepolia public-read implementation. Both feed the same decision engine.

No smart contract, ABI, address, Base Sepolia configuration, application
route, or public frontend is changed by the supervisor.

## Snapshot model

A system snapshot identifies its source, chain ID, contract address, optional
block number, explicit observation timestamp, pool count, and pools. A pool
contains the exact configuration and accounting exposed by current
`Pop33BasicV1.getPool()`, plus its `getDrawRound()` records.

Blockchain integers stay as `bigint` throughout analysis. JSON renders them as
decimal strings, so token values and timestamps do not lose precision.
Calculated values, such as missing draws, missing claims, elapsed pending
schedules, and time remaining, are supervisor-derived fields rather than
invented contract fields.

The decision engine never reads the wall clock. The adapter supplies
`observedAt`; the same snapshot, observation time, and configuration always
produce the same report.

## Exactly one `nextAction`

Each analyzed pool has exactly one primary result:

| Result | Meaning |
| --- | --- |
| `WAITING_FOR_PARTICIPANTS` | A consistent Open pool is below capacity. |
| `WAITING_FOR_FIRST_DRAW` | A consistent Locked pool has not reached round 1 time. |
| `WAITING_FOR_NEXT_DRAW` | A consistent Drawing pool has not reached the next sequential round time. |
| `DRAW_DUE` | The next sequential round is due and is within the configured notice window. |
| `DRAW_OVERDUE` | The next sequential round exceeded the notice window. |
| `CLAIMS_OUTSTANDING` | All rounds are finalized and at least one winner still has to claim. |
| `FINISHED` | All rounds and claims are complete, positions are released, and accounted pool escrow is zero. |
| `INCONSISTENT_STATE` | The snapshot is incomplete or contradicts the current contract lifecycle. |
| `NO_ACTION` | Reserved for adapters or future states that are valid but need no lifecycle operation. |

`INCONSISTENT_STATE` always takes priority over a normal recommendation. The
full `diagnostics` list remains available even when several checks fail, but
there is still only one primary action.

## Draw timing

Round `n` must be scheduled at:

`lockedAt + n * drawInterval`

The default overdue threshold is the exported and documented value of 900
seconds:

- before `scheduledAt`: wait;
- from `scheduledAt` through `scheduledAt + 900`: `DRAW_DUE`;
- after `scheduledAt + 900`: `DRAW_OVERDUE`.

The CLI can override this diagnostic threshold with
`--overdue-threshold SECONDS`. This does not change the contract schedule or
authorize execution.

If several pending schedules have elapsed, the result names only the first
pending sequential round. `elapsedPendingSchedules` can show that several
times passed, but the explanation explicitly says that the next operation is
still one round.

## Consistency checks

The engine fails closed on missing fields, unknown pool or round statuses, and
invalid numeric configuration. It also checks:

- pool capacity and the special Open/Locked position rules;
- presence or absence of `lockedAt` for the current status;
- sequential, unique round numbers and the exact round schedule;
- no later finalized round after an earlier pending round;
- no result data on Pending rounds and complete result data on Finalized
  rounds;
- no Claim on a Pending round and no more Claims than Draws;
- unique winning positions and, for the current one-position-per-wallet pool
  model, unique winner addresses;
- completed Draw and Claim counters against round records;
- assigned and claimed prize accounting;
- status-appropriate Draw and Claim progress;
- current Demo V1 finalization: all ten Claims before `Finished`;
- accounted pool escrow.

Escrow validation uses `Pool.escrowedAmount`, not the token contract's raw
balance. Direct token donations can create surplus at the contract address
without changing POP33's accounted escrow and are not reported as a pool
escrow error.

## Commands

Run commands from `packages/contracts`.

Human-readable multi-pool fixture:

```text
npm run supervisor -- --fixture multi-pool
```

Deterministic JSON:

```text
npm run supervisor -- --fixture multi-pool --json
```

Filters can be combined:

```text
npm run supervisor -- --fixture multi-pool --pool 2
npm run supervisor -- --fixture multi-pool --only-actionable
npm run supervisor -- --fixture multi-pool --only-warnings --json
```

Available fixtures are:

- `empty-open`;
- `open-50`;
- `open-99`;
- `locked-before-first-draw`;
- `multi-pool`.

## Base Sepolia public-read adapter

The Base Sepolia adapter uses a viem public client. It creates no account or
wallet client and has no transaction method. The adapter validates chain ID
`84532`, checks bytecode at the selected contract address, chooses one block,
reads that block's timestamp, and pins every contract read and bytecode check
to that exact block.

The canonical contract address comes from `src/demo-v1/safety.ts`:

`0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F`

The ABI is imported from `src/demo-v1/abi.ts`. The adapter does not maintain a
second handwritten ABI.

The default command uses the existing credential-free public endpoint:

```text
npm run supervisor -- --source base-sepolia
```

JSON and one-pool analysis:

```text
npm run supervisor -- --source base-sepolia --pool 1 --json
```

Bounded range and repeatable historical block:

```text
npm run supervisor -- --source base-sepolia --from-pool 1 --to-pool 3
npm run supervisor -- --source base-sepolia --block 55555555 --json
```

Optional configuration:

```text
BASE_SEPOLIA_SUPERVISOR_RPC_URL=https://provider.example/base-sepolia
BASE_SEPOLIA_SUPERVISOR_CONTRACT_ADDRESS=0x...
```

The RPC URL must use HTTPS and cannot contain URL username/password
credentials. Reports include only its host; paths, query strings, fragments,
and possible provider tokens are never included. Avoid placing provider URLs
in shell history, screenshots, issues, logs, or committed files.

The contract override is read-only and must be a valid non-zero address. The
default remains the reviewed Demo V1 address.

### Pool discovery and block consistency

`poolCount()` provides the current upper pool ID. Pool IDs are created
sequentially from 1, so the adapter reads `getPool(id)` across the full count
or an explicitly bounded range. For Locked, Drawing, Claimable, Finished, and
unknown statuses with a usable round count, it reads each
`getDrawRound(poolId, roundNumber)`. Open pools have no initialized round
records, so their snapshot intentionally contains an empty round list.

The adapter first resolves the selected block number (or accepts `--block`).
It then uses the same block for:

- block timestamp;
- contract bytecode;
- `poolCount()`;
- every `getPool()`;
- every `getDrawRound()`.

If the provider returns another block, the adapter rejects the snapshot. A
range snapshot retains the real total `poolCount` and separately records the
requested range.

### Event logs

No event logs are used. Current direct getters contain every field required by
the supervisor, and `poolCount()` discovers the complete ID range. The
canonical POP33 deployment block is `44144873`, as recorded in
`docs/DEMO_V1.md`, but it is not queried by this adapter.

Any future log-backed extension must use a positive, explicit deployment block
and a bounded range. Missing deployment metadata is a hard error; scanning
from genesis or an unbounded scan is not permitted.

### Errors and incomplete data

The adapter distinguishes wrong chain, unavailable RPC, timeout, missing
bytecode, ABI/method mismatch, decode failure, invalid ranges, a mismatched
block, and a failed partial pool read. Errors identify the method, pool when
known, and block when known, and state that the snapshot is incomplete.

If a successful contract response lacks an expected struct field, the adapter
preserves that field as missing instead of inventing zero. The snapshot is
marked incomplete, and the existing engine returns `INCONSISTENT_STATE`.
Failure while reading one of a pool's rounds rejects the whole snapshot rather
than combining partial data with apparently healthy pools.

Public RPC endpoints can be unavailable, rate-limited, or unable to serve an
older block. Rate limits use the existing bounded read-only retry. The viem
transport has a 10-second default timeout and no independent retry loop; the
CLI accepts `--timeout-ms` from 1000 through 60000.

An ordinary due or overdue Draw is a lifecycle signal, not a CLI failure.
The CLI uses a nonzero result only for an inconsistent selected pool, invalid
input, or an adapter/read error.

## Snapshot safety and `planId`

Every plan includes its source, chain, contract, block (when available),
observation time, pool ID, input status, proposed round, key counters, escrow,
and a deterministic SHA-256 `planId`. No randomness or secret contributes to
the ID.

`planId` is an identity for the observed plan, not a lock and not transaction
authorization. State can change immediately after the read. A future separate
executor must re-read the chain before any transaction and confirm at least:

- the same contract and chain;
- a sufficiently fresh block;
- the same pool status and counters;
- the same next sequential round;
- that another permissionless caller has not already executed it.

## Saved action plans and freshness revalidation

The supervisor can now save one pool's result as a versioned lifecycle action
plan and later compare it with a newly read snapshot. The saved plan is data,
not executable code. Revalidation is also read-only: it creates no account or
wallet client, loads no key or signer, and never calls Draw.

Only `DRAW_DUE` and `DRAW_OVERDUE` become an `actionable` plan with planned
action `DRAW`. Waiting, outstanding Claims, and Finished are
`informational`. Inconsistent complete state is `blocked`; incomplete source
data is `invalid`. None of these classifications executes an operation.

Create a plan for one Base Sepolia pool:

```text
npm run supervisor -- --source base-sepolia --pool 2 --create-plan lifecycle-plan.json
```

The CLI refuses to overwrite an existing file unless
`--overwrite-plan` is supplied. Relative paths must remain under the current
working directory, absolute paths are treated as an explicit user choice, and
the extension must be `.json`. Files are parsed only with `JSON.parse`.

Re-read the plan's source, contract, and pool and compare fresh state:

```text
npm run supervisor -- --revalidate-plan lifecycle-plan.json
npm run supervisor -- --revalidate-plan lifecycle-plan.json --json
npm run supervisor -- --revalidate-plan lifecycle-plan.json --max-plan-age 3600
```

For deterministic fixtures, the saved fixture name is reused automatically.
For Base Sepolia, the adapter reads a new pinned block. An explicit read-only
contract override remains possible, but a different address produces
`BLOCKED`, never `VALID`.

### Plan structure

The plan contains:

- format version, deterministic plan ID, creation timestamp, and fingerprint;
- source type and source reference;
- chain ID, checksummed contract address, contract-interface identifier,
  base block number, and base block timestamp;
- pool ID, expected pool status, supervisor action/reason, classification,
  planned action, and round/winner identifier when relevant;
- only the critical lifecycle assumptions needed for comparison: snapshot
  completeness, position/capacity values, round and Claim counters, accounted
  escrow, assigned/claimed amounts, and the relevant round state.

It does not copy complete user data, RPC URLs, wallet state, credentials,
cookies, tokens, private keys, or mnemonics. All blockchain integers are
canonical unsigned decimal strings. No large value is converted to JavaScript
`number`.

Example:

```json
{
  "formatVersion": 1,
  "planId": "lifecycle-plan:5100afb4c485b5b571108ef9d3e50ef782baafa187d8675c5c1c2b7195acc480",
  "fingerprint": "sha256:5100afb4c485b5b571108ef9d3e50ef782baafa187d8675c5c1c2b7195acc480",
  "createdAt": "1800000000",
  "source": {
    "type": "fixture",
    "reference": "multi-pool"
  },
  "identity": {
    "chainId": "31337",
    "contractAddress": "0x0000000000000000000000000000000000000033",
    "contractInterface": "Pop33BasicV1:src/demo-v1/abi:v1",
    "baseBlockNumber": "12345",
    "baseBlockTimestamp": "1800000000"
  },
  "scope": {
    "poolId": "2",
    "expectedPoolStatus": "Locked",
    "supervisorAction": "DRAW_OVERDUE",
    "supervisorReasonCode": "NEXT_DRAW_OVERDUE",
    "classification": "actionable",
    "plannedAction": "DRAW",
    "roundNumber": "1",
    "winningPositionId": "0"
  },
  "assumptions": {
    "snapshotComplete": true,
    "activePositionCount": "100",
    "maxPositionCount": "100",
    "drawRoundCount": "10",
    "completedDrawRoundCount": "0",
    "claimedPrizeCount": "0",
    "escrowedAmount": "3300000000",
    "assignedPrizeAmount": "0",
    "claimedPrizeAmount": "0",
    "nextRoundScheduledAt": "1799996400",
    "nextRoundStatus": "Pending",
    "nextRoundWinningPositionId": "0",
    "nextRoundClaimed": false
  }
}
```

### Canonical fingerprint

The fingerprint is SHA-256 over the complete plan payload except the two
derived integrity fields, `planId` and `fingerprint`. Object keys are sorted
recursively, arrays preserve their order, and `bigint` values are represented
as decimal strings. Therefore key order and pretty-printing do not change the
digest, while changing any identity, scope, or assumption does.

`planId` and `fingerprint` use the same digest with different prefixes. Both
are checked while parsing. This detects accidental edits and inconsistent
critical fields; it is not a signature, does not authenticate an operator, and
does not protect a file from a deliberate attacker who can rewrite both the
payload and hash.

### Revalidation statuses

| Status | Meaning |
| --- | --- |
| `VALID` | Format and fingerprint are valid; identity, block direction, completeness, supervisor action, round, and critical assumptions still match. |
| `STALE` | The plan was valid, but lifecycle state changed or the plan exceeded its maximum age. Generate a new plan. |
| `BLOCKED` | A wrong identity, older block, unsafe Draw timing, unknown/inconsistent state, escrow error, or higher-priority alert prevents safe use. |
| `INCOMPLETE` | Missing block, partial snapshot, missing round/field, or another data gap prevents a safe decision. |
| `INVALID_PLAN` | JSON, schema, type, address, required field, plan ID, or fingerprint validation failed. |

The default maximum age is 7,200 seconds, suitable as a conservative
two-interval ceiling for the current hourly Demo V1. `--max-plan-age SECONDS`
can reduce or explicitly change it. Age is only one check: a young plan still
must pass every identity and state comparison.

Chain ID, contract address, contract-interface ID, source, pool ID, block
number, and block timestamp are always checked. A fresh block must be at least
the base block. Missing evidence fails closed.

Example `VALID`:

```text
Plan status: VALID
Pool: 2
Base block: 12345
Fresh block: 12345

Changed:
- none

Decision:
The saved plan still matches the fresh read-only snapshot.
```

Example `STALE`:

```text
Plan status: STALE
Pool: 2
Base block: 44822142
Fresh block: 44822510

Changed:
- scope.expectedPoolStatus: Locked -> Drawing [critical] The pool lifecycle status changed.
- assumptions.completedDrawRoundCount: 0 -> 1 [warning] A critical lifecycle assumption changed since plan creation.
- scope.supervisorAction: DRAW_OVERDUE -> WAITING_FOR_NEXT_DRAW [critical] The supervisor now recommends a different action.

Decision:
Do not use the saved plan. Generate a new plan from the fresh snapshot.
```

Each diff entry contains a field, expected value, fresh value, severity, and a
short explanation. Reports avoid dumping full snapshots.

### CLI exit codes

| Code | Result |
| ---: | --- |
| `0` | `VALID` |
| `10` | `STALE` |
| `11` | `BLOCKED` |
| `12` | `INCOMPLETE` |
| `13` | `INVALID_PLAN` |
| `14` | Base Sepolia adapter or RPC failure |

Creating a plan successfully returns zero. Ordinary supervisor behavior
without plan flags remains unchanged.

## What this does not solve

This stage does not complete the public exact-99 participant process, automate
Draw, automate claims or payouts, select production randomness, or resolve the
`TO DECIDE` claim-expiry and stalled-pool rules. The Base Sepolia result remains
a point-in-time public snapshot, not continuous monitoring.

A future executor must remain a separate security boundary. The supervisor can
provide its snapshot and plan to that component, but the executor is not part
of this implementation. The next separately reviewed stage is a guarded
single-Draw operator that consumes only a freshly revalidated actionable plan
and retains an independent transaction security boundary.
