# Base Sepolia exact-99 read-only readiness

Status: implemented read-only planning and revalidation; no wallet creation or
transaction authorization

Prepared: 2026-07-30

## Purpose

Readiness combines one pinned Base Sepolia snapshot, the lifecycle supervisor,
public owner data, optional public address inputs, and dynamic checkpoint
calculation:

```text
Base Sepolia snapshot
  -> lifecycle supervisor
  -> public owner/routing checks
  -> dynamic 5 / 20 / 50 / 99 / manual-100 readiness plan
```

The result always contains:

`READ_ONLY — NOT AUTHORIZATION TO EXECUTE`

It cannot create a wallet, load or decrypt a wallet store, load a key, sign,
simulate a write, send a transaction, call a faucet, approve, Join, Draw,
Claim, Withdraw, or deploy.

## Commands

Run from `packages/contracts`.

Current public readiness for an explicitly selected pool:

```powershell
npm run supervisor -- --exact99-readiness --pool 1
npm run supervisor -- --exact99-readiness --pool 1 --json
```

Optional public candidate address:

```powershell
npm run supervisor -- --exact99-readiness --pool 1 --candidate-address 0x...
```

For the narrow, mobile-first preparation from the currently expected `3/100`
state to a hard stop at `5/100`, use
`docs/RUNBOOK_BASE_SEPOLIA_MANUAL_CHECKPOINT_5.md`. It checks two distinct
public candidates sequentially and requires a new pinned snapshot after the
first future manual Join. That runbook does not create wallets or authorize a
transaction.

Optional public-only manifest:

```powershell
npm run supervisor -- --exact99-readiness --pool 1 --manifest exact99-public-addresses.json
```

Create a versioned readiness plan. Existing files are not overwritten unless
`--overwrite-plan` is also supplied:

```powershell
npm run supervisor -- --exact99-readiness --pool 1 --create-readiness-plan exact99-readiness.json
```

Revalidate against a fresh pinned snapshot:

```powershell
npm run supervisor -- --revalidate-readiness-plan exact99-readiness.json
```

If the saved plan was manifest-bound, the same reviewed manifest must be
supplied again with `--manifest`.

## Pool selection and routing

The CLI requires an explicit positive pool ID. It never silently assumes that
Pool 1 is appropriate.

At the pinned block it checks:

- the selected pool exists, is `Open`, and remains below capacity;
- accounted escrow equals `activePositionCount * entryPrice`;
- the supervisor reports a consistent `WAITING_FOR_PARTICIPANTS` state;
- the ordered `getOpenPoolIds()` result;
- `MAX_OPEN_POOLS()` and whether all ten open-pool slots are occupied;
- whether an earlier open pool can accept a generic new address.

For an optional candidate, pinned direct reads check
`getActivePositionId(poolId, address)`, `activePositionsByUser(address)`,
`MAX_ACTIVE_POSITIONS_PER_USER()`, and
`findOldestQualifyingPool(address)`.

`ELIGIBLE` means only that current public reads route the address to the
selected pool. Because `join()` has no expected pool or expected count
argument, an external Join can still change routing before a future
transaction. Readiness never promises that a future Join will land in a
particular pool. A manual runbook may label a complete, fresh `ELIGIBLE` result
as `ELIGIBLE_FOR_MANUAL_JOIN` for session recording, but:

`Eligibility is not authorization to execute a transaction.`

## Owner mapping

The preferred path is direct:

1. read global `positionCount()` at the pinned snapshot block;
2. reject enumeration above the explicit 10,000-position safety cap;
3. read `getPosition(positionId)` at the same block;
4. retain active positions belonging to the selected pool;
5. require unique active owners;
6. compare the resulting active-owner count with `getPool()`.

This uses the existing frontend ABI. No second ABI is embedded.

If direct enumeration is unavailable or exceeds the cap, the fallback scans
only canonical `PositionJoined` logs:

- contract `0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F`;
- deployment block `44144873` through the pinned snapshot block;
- pool-indexed event filter;
- inclusive chunks of at most 2,000 blocks by default;
- duplicate/conflict checks;
- final direct `getPosition()` reconciliation and count comparison.

Any missing or contradictory data produces `INCOMPLETE`.

## Dynamic checkpoints

For snapshot count `c`, every target uses:

`remainingFromSnapshot = max(0, target - c)`

`positionsInPhase` starts at the greater of the snapshot count and the previous
checkpoint. For example, count 3 yields:

| Target | Remaining from snapshot | In phase |
| ---: | ---: | ---: |
| 5 | 2 | 2 |
| 20 | 17 | 15 |
| 50 | 47 | 30 |
| 99 | 96 | 49 |
| 100 | 97 | 1, manual only |

At exactly `99/100`, a consistent Open pool returns
`READY_FOR_MANUAL_100_CHECK`. This is not authorization for Join.

## Public manifest

The optional format contains only:

- format version and purpose;
- chain, contract, token, and selected pool identity;
- decimal address count;
- the ordered automatic address list;
- one separately reserved manual-100 public address;
- a canonical SHA-256 fingerprint.

The validator requires the automatic list length to equal the current
`remainingTo99`, rejects duplicates, active owners, the reserved manual
address, unsupported fields, secret-shaped fields or values, keystore/store
paths, wrong network identity, and a changed fingerprint.

No private key, mnemonic, credential, signer, or wallet-store reference is
permitted. A missing manifest is reported as `MANIFEST_NOT_PROVIDED`.

## Readiness decisions

| Status | Meaning |
| --- | --- |
| `READY_TO_PREPARE` | Public state is safe for preparing a manifest and testnet resource plan only. |
| `READY_FOR_CHECKPOINT` | Snapshot, owner mapping, routing, and public manifest match the next dynamic checkpoint. |
| `READY_FOR_MANUAL_100_CHECK` | Pool is exactly 99/100 and Open; begin a separate manual readiness review only. |
| `STALE` | Revalidation detected changed state or plan age. |
| `BLOCKED` | A critical state, status, escrow, supervisor, candidate, or routing condition blocks progress. |
| `INCOMPLETE` | Public reads or owner/manifest evidence are incomplete. |
| `INVALID_INPUT` | Pool, address, manifest, or CLI input is invalid. |

Exit codes are `0` for the three positive read-only decisions, `10` for
`STALE`, `11` for `BLOCKED`, `12` for `INCOMPLETE`, `13` for
`INVALID_PLAN`, and `15` for `INVALID_INPUT`.

## Fingerprint and revalidation

Readiness reuses the existing key-order-independent canonical JSON serializer
and SHA-256 implementation. The fingerprint binds network and contract
identity, pool, pinned snapshot, count, escrow, checkpoint calculations, owner
mapping fingerprint, optional manifest fingerprint, optional candidate result,
routing assessment, risks, and supervisor decision. It is an integrity digest,
not an operator signature.

Revalidation requires:

- the same chain, contract, interface, token, and pool;
- a fresh block at or after the base block;
- an `Open`, complete, consistent pool;
- unchanged count, escrow, owners, manifest, candidate result, routing, dynamic
  checkpoints, and supervisor recommendation;
- a plan age within the configured limit.

A count or owner change returns `STALE` and recalculation is mandatory. A
transition to `Locked` returns `BLOCKED`. RPC or owner-data failure returns
`INCOMPLETE`. The manifest is never shortened or modified automatically.

## Legacy exact-99 boundaries

- Wallet store v1 is not approved for live exact-99. It decrypts the complete
  key set and readiness never imports it.
- The cumulative coordinator remains a fixture for an initially empty pool;
  its fixed wallet-index ranges are not used here.
- The cumulative execution runner remains fixture-only and must not be wired
  to Base Sepolia.
- The wallet store v2 file remains a fixture prototype, not a real store.

Before creating wallets or performing any transaction, the complete operator
stack must be reviewed and consolidated into `codex/pop33-recovery`.
