# Base Sepolia exact-99 cumulative accumulation coordinator

Status: fixture-only plan, inspection, and simulation prepared; no public runner

Prepared: 2026-07-27

## Simple purpose

The coordinator prepares a safe order for the future 99-wallet lifecycle
without connecting to Base Sepolia. It divides the automatic participants into
four reviewable checkpoints:

| Checkpoint | New indices | Wallets in range | Cumulative wallets |
| --- | ---: | ---: | ---: |
| `checkpoint-5` | `0-4` | 5 | 5 |
| `checkpoint-20` | `5-19` | 15 | 20 |
| `checkpoint-50` | `20-49` | 30 | 50 |
| `checkpoint-99` | `50-98` | 49 | 99 |

These ranges are fixed, disjoint, cover every index from `0` through `98`
exactly once, and never include index `99`. The split gives Piotr a deliberate
stop after each larger sample so artifact consistency and accumulated results
can be reviewed before more testnet activity is eventually authorized.

## Artifact binding

The coordinator accepts only the existing exact-99 artifact identity:

- store ID and set ID;
- manifest fingerprint and ordered-address digest;
- the same checkpoint and append-only journal;
- the capped funding plan and its deterministic plan ID; and
- exactly 99 manifest addresses in their recorded order.

Each simulated journal event adds a coordinator binding containing the
checkpoint ID, range boundaries, ordered-address digest, and funding-plan ID.
The operation ID, public wallet index and address, operation type, status,
fixture transaction hash where applicable, reconciliation result, and
timestamps remain in the shared journal. No alternative state file or journal
was introduced.

The current wallet, next operation, last completed index, and per-range
completion counts are derived from the journal and reconciled with the existing
checkpoint counters. They are not duplicated as a second source of truth.

## Per-wallet order

For every automatic wallet the only prepared order is:

`funding -> faucet -> approve -> join`

One operation must be terminally complete before the next operation for that
wallet can appear. A later wallet cannot start before the preceding wallet is
complete. There is no parallel fixture path.

Confirmed operations are never appended again. A complete wallet is skipped
on restart. A partially complete wallet resumes at its first unfinished
operation. Existing operation IDs and transaction hashes cannot change.

## Separate authorization for every checkpoint

Fixture simulation requires the exact phrase for the currently allowed range:

```text
AUTHORIZE POP33 EXACT 99 CHECKPOINT 5
AUTHORIZE POP33 EXACT 99 CHECKPOINT 20
AUTHORIZE POP33 EXACT 99 CHECKPOINT 50
AUTHORIZE POP33 EXACT 99 CHECKPOINT 99
```

A missing or wrong phrase, a phrase for another checkpoint, a skipped
checkpoint, or an attempt to repeat a completed checkpoint is rejected. These
phrases currently authorize only local fixture simulation. They do not
authorize public RPC use or a transaction.

## Local modes

The only accepted modes are:

- `plan` - reports the current checkpoint and range, the first unfinished
  wallet operation, completed counts, and any blocker;
- `inspect` - validates all artifact bindings, ranges, ordering, counters,
  recovery state, and the automatic hard stop; and
- `simulate` - appends deterministic fixture outcomes to in-memory fixture
  checkpoint and journal values, then runs the complete local reconciliation.

There is no public runner and no mode that transports a transaction.

## Stop-on-first-error

The current range stops immediately on the first:

- failed operation;
- pending result;
- ambiguous or inconsistent fixture receipt;
- manual-review result;
- manifest, funding-plan, wallet-order, checkpoint, or journal mismatch;
- operation outside its checkpoint range; or
- attempt to skip a wallet, operation, or checkpoint.

No later operation, wallet, or checkpoint is processed after that result.
Pending and ambiguous states remain blockers. Failed and manual-review outcomes
move the fixture checkpoint to `manual-review`.

## Restart and recovery

A safe fixture restart requires another complete local preflight. The
checkpoint and journal counters must reconcile, all bindings must remain
unchanged, and no pending, ambiguous, failed, or manual-review operation may
remain. Continuing the current range requires its exact authorization phrase
again.

This task does not resolve uncertain transaction evidence. A future public
runner must add chain-specific read-only reconciliation before any continuation
can be authorized.

## Hard stop after index 98

Completing index `98` produces 99 confirmed automatic joins and moves the
checkpoint directly to:

`awaiting-manual-100`

At that point the automatic next operation is `null`. The coordinator rejects
index `99`, a journal entry of type `manual-100`, and any attempt to simulate a
one-hundredth join. The separate manual boundary operation is intentionally not
implemented here.

This is retained as the original local coordinator behavior so existing
fixtures and the runner remain compatible. The stricter future public overlay
does not mutate these artifacts: normal execution ends at index `97` (98
positions), while index `98` is admitted only by the separately authorized
`boundary-99` model with fresh dual-source evidence and a one-use snapshot.
See
`docs/RUNBOOK_BASE_SEPOLIA_EXACT_99_PUBLIC_EXECUTION_PROTOCOL.md`.

## Current authorization boundary

All behavior in this milestone is local and fixture-only. No real wallet
store, wallets, signer, funding plan artifact, checkpoint, or runtime journal
was created. No environment secret was read. No Base Sepolia RPC connection,
ETH transfer, faucet, approval, join, withdrawal, draw, claim, deployment, or
Vercel action occurred.

The fixture-only public execution protocol now adds journal v2, global locking,
nonce/fee guards, dual-source evidence, finality and the boundary overlay.
Public adapter construction, real artifact materialization, funding, and
lifecycle operations remain separate future authorizations.
