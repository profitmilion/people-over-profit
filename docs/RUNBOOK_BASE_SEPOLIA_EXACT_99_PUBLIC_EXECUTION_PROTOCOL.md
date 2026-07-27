# Base Sepolia exact-99 public execution protocol v1 and durable journal v2

Last reviewed: 2026-07-27

Status: fixture-only specification and executable local model; no public
adapter, provider, signer, endpoint, or transaction transport exists.

## Simple purpose

The existing cumulative runner proves ordering and semantic reconciliation,
but it does not yet define every durable boundary needed around a future
public transaction. This protocol fills that gap without connecting to a
network.

Its most important rule is: persist enough identity before every irreversible
step that a restarted process can decide whether it may continue, must wait,
or must stop for manual review. It must never guess that a transaction was not
sent.

## One-operation protocol

A future adapter must execute one wallet and one operation at a time:

1. acquire the global run lock;
2. perform the local artifact preflight;
3. obtain two independent block-tagged snapshots;
4. prepare the operation request;
5. atomically persist `prepared`;
6. reserve the nonce;
7. atomically persist `nonce-reserved`;
8. calculate gas and fee caps;
9. persist the complete unsigned request and its digest;
10. ask an isolated signer session to simulate signing in the current fixture;
11. calculate the signed transaction hash locally;
12. persist `signed` before any broadcast;
13. attempt the fixture broadcast;
14. persist `broadcast-attempted`;
15. persist `pending`;
16. persist a complete receipt as `mined`;
17. perform semantic reconciliation;
18. wait for the configured confirmation depth;
19. recheck the canonical block hash through both read sources;
20. persist `confirmed`;
21. perform a later recheck and persist `checkpoint-final`;
22. derive the v1 lifecycle checkpoint update from that final journal record;
23. close the isolated signer session and release the global run lock.

The signed hash must be durable before broadcast because a process may crash
after the remote node accepts a transaction but before it returns a response.
With the local hash, recovery can search for exactly the already-signed
transaction. Without it, the operator cannot distinguish "never sent" from
"sent but response lost" and must not create a replacement automatically.

The fixture implementation accepts hashes and outcomes as input. It does not
sign, serialize, submit, or broadcast a transaction.

## Durable journal v2

Journal v2 is a separate, serializable, checksummed, append-only schema. It does not replace
or silently migrate the existing fixture journal v1. Every state transition
appends a complete attempt snapshot, increments the revision, and recalculates
the checksum.

An attempt binds:

- schema, set, store, run, manifest, checkpoint, range, wallet and public
  address identity;
- operation ID, attempt ID, optional replacement link, operation type, signer
  role, chain, contract, token, target and value;
- calldata digest, complete unsigned request, request digest, nonce, gas limit,
  fee fields and total fee cap;
- locally calculated signed hash and only a boolean saying whether raw bytes
  were created;
- broadcast-attempt identity without credentials and the returned transport
  hash;
- receipt block number/hash, transaction index and status;
- confirmation depth, finality, semantic result, before/after state digests,
  canonical-recheck evidence, recovery status, manual-review reason and
  timestamps.

Journal v2 explicitly forbids passwords, mnemonic/seed material, credential
URLs, raw signed transaction bytes, and private wallet material. A future
encrypted signed-transaction outbox would require a separate design and
authorization; it is not implemented here.

## Forward-only states

The normal sequence is:

`planned -> prepared -> nonce-reserved -> signed -> broadcast-attempted -> pending -> mined -> reconciling -> confirmed -> checkpoint-final`

Stopping or terminal review states are:

`failed`, `ambiguous`, `replaced`, `cancelled`, `reorged`, and
`manual-review`.

States cannot move backwards. `confirmed` requires a successful receipt,
matched semantic reconciliation, and the configured confirmation threshold.
`checkpoint-final` additionally requires a later canonical block recheck and
its separate threshold. A reorg may invalidate an earlier confirmed or
checkpoint-final result and blocks further progress.

One attempt has one nonce and one signed hash. A replacement has a new attempt
ID, retains an explicit link to the original attempt, and requires an exact
manual fixture authorization. It is never automatic. A failed broadcast that
consumed a nonce is recorded as `failed-consumed-nonce`, not as an unsent
operation.

## Nonce manager

The fixture nonce manager compares `latestNonce`, `pendingNonce`, the journal's
expected nonce and known journal/external transactions.

- only one unresolved transaction may exist per signer;
- different latest and pending values block new work unless the sole pending
  transaction exactly matches the journal;
- a manual/external transaction blocks that signer;
- cancellation and dropped evidence require review;
- dropped does not mean reusable;
- two attempt IDs may share a nonce only through explicit replacement links;
- funding and participant roles use different mutex namespaces.

No nonce is changed and no replacement is created during recovery.

## Fee guard

All numeric examples in tests are fixture wei values, not approved operating
amounts. The guard requires an explicitly fixture-labelled profile and checks:

- maximum operation gas;
- maximum multiplier over the estimate;
- max fee and priority fee per gas;
- operation, wallet, checkpoint and run cost caps;
- funding-signer and participant reserves;
- an optional reserve for a later claim.

Incomplete estimates, fee spikes, any exceeded cap, reserve violations, and
automatic cap increases stop the operation. Real Base Sepolia values remain a
separate decision based on fresh evidence.

## Global run lock

The fixture global lock covers the complete session: preflight, signer role,
journal append and checkpoint derivation. It binds run/set/store/manifest,
journal checksum and revision, PID, host, start time, checkpoint, signer role,
wallet index and operation ID.

A second process cannot acquire the same set. A missing PID alone never
deletes the lock. A suspected stale lock first enters `manual-review`; takeover
then requires an exact phrase and cannot change the artifact identity.
Revision or checksum conflict stops update and release.

Fault tests cover crashes before and after acquire, update and release. The
fixture registry is an executable concurrency model, not yet a durable
cross-process filesystem implementation.

## Dual-source evidence

Each fixture source returns chain ID, exact block number/hash, parent hash,
timestamp, contract/token code hashes, ABI digest, contract-parameter digest
and operation-state digest. Both sources must report the same exact block and
the same values, and contract/token identity must match the manifest.

Using two sources is not a vote between different blocks. Mixing a balance
from one block with a pool count from another can produce a state that never
existed. Missing data or any disagreement stops the operation. The accepted
pair is reduced to a structured evidence digest.

No endpoint, fallback broadcast source, or provider exists in this milestone.

## Mined, confirmed, checkpoint-final and reorg

- `mined` means a receipt was observed in a particular block. The block may
  still be replaced.
- `confirmed` means the receipt remains canonical in both sources, semantic
  reconciliation matches, and the configured first depth is reached.
- `checkpoint-final` is a later and stronger gate: a fresh canonical recheck
  and the separately configured checkpoint depth both pass.

A reorg is a chain reorganization that replaces a previously observed block.
Receipt disappearance, a changed block hash, or movement of the transaction to
another block is reorg evidence. It invalidates finality and forces manual
investigation even after `confirmed` or `checkpoint-final`.

The test thresholds are configurable fixtures. This document deliberately does
not approve one real confirmation policy.

## Recovery decisions

The inspector returns exactly one of:

`safe-to-prepare`, `safe-to-broadcast-signed-transaction`, `wait-pending`,
`reconcile-mined`, `wait-confirmations`, `confirmed`, `checkpoint-final`,
`failed-consumed-nonce`, `investigate-replacement`,
`investigate-cancellation`, `investigate-reorg`, `ambiguous`,
`manual-review`, or `do-not-retry`.

It never creates an attempt after ambiguity, changes nonce or fees, performs a
replacement, deletes history, or treats absence in one source as proof that a
transaction was never sent. "Safe to broadcast" refers only to the already
persisted signed hash, not permission to prepare a different transaction.

## Public accumulation boundary

The existing local coordinator and runner remain unchanged for fixture
compatibility. The future public protocol adds a stricter overlay:

- checkpoint 5: indices `0-4`;
- checkpoint 20: indices `5-19`;
- checkpoint 50: indices `20-49`;
- normal checkpoint-99 path: indices `50-97`, ending at 98 positions;
- `boundary-99`: only index `98`, ending at 99 positions.

Boundary index `98` gets its own gate because another participant could join
between the last normal read and this high-impact operation. It requires the
exact authorization and threat acknowledgment, exactly 98 positions, expected
pool and escrow, `Open`, `lockedAt == 0`, two identical fresh fixture
snapshots, no foreign event, Piotr's future manual wallet readiness, consistent
nonce, no pending transaction, and a one-use snapshot ID.

The fixture result after index `98` is `awaiting-manual-100`. Index `99` is
rejected everywhere. There is no manual 100th join implementation.

## Fault-injection evidence

Tests cover every requested transaction persistence window: before/after
prepared, nonce reservation, both sides of simulated signing persistence,
unanswered broadcast, returned broadcast hash, receipt before mined, mined
before reconciliation, reconciliation before confirmed, and confirmed before
checkpoint. They also cover two-process conflict, corrupt journal/checksum,
dual-source disagreement, replacement, cancellation, reorg, and an external
join before or between boundary snapshots.

Every uncertain case waits or enters review. No test creates an automatic
second execution.

## Current authorization boundary

This milestone created source code, documentation and temporary test fixtures
only. It did not create a real exact-99 store, wallet, key, signer, provider,
endpoint, runtime manifest, runtime journal, transaction, transfer, join,
draw, claim, deployment, or Vercel change.

The next task should independently review and Git-checkpoint this fixture-only
protocol. Building the durable public adapter remains separately scoped and
must not begin until the store v2 decision and threat gates are accepted.
