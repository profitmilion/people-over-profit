# Base Sepolia full lifecycle plan: 99 automatic participants + 1 manual participant

Status: analysis and execution plan only

Prepared: 2026-07-18

Network: Base Sepolia (`84532`)

## Authorization boundary

This document does not authorize wallet creation, funding, signing, broadcast,
or a contract, frontend, Vercel, Production, or Farcaster change. It records
the evidence from the completed reversible two-wallet pilot and decomposes a
future full-lifecycle test into separately reviewed stages.

The completed five-wallet pilot recovery unit must be retained unchanged. It
must not be expanded into the full-lifecycle participant set. The future test
should use:

- one new encrypted operator store containing exactly 99 fresh automatic
  participant wallets;
- Piotr's separate public wallet as the manually confirmed 100th participant;
- a separate testnet funding wallet with its own credential boundary;
- a separately selected draw executor; and
- signer access to each winning participant wallet for its own claim.

The exact-99 initializer and local read-only inspector were prepared and tested
on 2026-07-19, but Piotr's real store and the funding subsystem were not
created. Running the initializer remains a separate authorization.

## Confirmed deployed behavior

The following behavior is confirmed by `Pop33BasicV1.sol` and its automated
tests, not merely intended by product documentation:

1. A successful join pays exactly 33 dUSDC and is assigned to the oldest
   qualifying Open pool. The caller does not provide an expected pool ID or
   expected participant count.
2. Pool 1 remains Open through 99 active positions. The 100th successful join
   adds its position and escrow and atomically changes the pool to `Locked`,
   records `lockedAt`, creates ten scheduled round records, and removes the
   pool from the Open index. A reverted payment or join rolls the entire
   boundary transition back.
3. Withdrawal is allowed only while the pool is Open. No participant can
   withdraw after the 100th join locks it.
4. On the deployed Demo V1, round `n` becomes eligible at
   `lockedAt + n * 3600 seconds`. Time passing does not execute a draw.
5. `executeDraw(poolId, round)` is permissionless, sequential, rejects early,
   duplicate, and out-of-order calls, and changes `Locked` to `Drawing` on the
   first draw. The temporary block-derived entropy is caller/validator
   influenceable and is not production-safe.
6. Each draw removes its selected position from the candidate set, so the ten
   winning positions and wallets are distinct. After draw 10 the pool becomes
   `Claimable`.
7. A winner may claim a finalized round before later rounds are drawn. The
   proposed test deliberately completes all ten draws before claims for easier
   reconciliation; that ordering is an operational choice, not a contract
   requirement.
8. Only the recorded winner can claim its round, exactly once, for exactly
   330 dUSDC. The tenth completed claim changes the pool to `Finished`, clears
   escrow, and releases all 100 positions from their owners' active counts.
9. There is no claim expiry, unclaimed-prize rescue, stalled-pool settlement,
   or automatic draw scheduler in this deployment. A missing winner claim
   leaves the pool unfinished and the remaining prize escrowed.

## Documentation baseline and TO DECIDE

The approved Basic V1 documentation agrees on 100 positions at 33 dUSDC, ten
different winners, 330 dUSDC per round, hourly Base Sepolia eligibility,
pull-based claims, no withdrawal after lock, and the lifecycle
`Open -> Locked -> Drawing -> Claimable -> Finished`.

The following are still policy or production architecture decisions and must
not be inferred from the temporary testnet implementation:

- `TO DECIDE`: production randomness and verifiable request/fulfillment flow;
- `TO DECIDE`: who is responsible for draw triggering and how that actor is
  authorized or incentivized;
- `TO DECIDE`: claim expiry and treatment of unclaimed prizes;
- `TO DECIDE`: recovery for a stalled pool, failed draw, or failed payout;
- `TO DECIDE`: emergency or administrative powers;
- `TO DECIDE`: whether a production pool can finish independently of all ten
  winner claims.

## Why 99 + 1 is recommended

Ninety-nine automatic wallets exercise repeatable participant accumulation
without allowing the operator to cross the lock boundary. Piotr's separate
wallet then tests the real public wallet, network confirmation, exact payment,
and visible transition caused by the 100th join. The automatic operator must
have a hard upper bound of 99 successful joins and no callable final-join path.

This split does not eliminate a public race. Because `join()` has no expected
pool or expected-count guard, an external account can take position 100 after
the final read and before Piotr's transaction is included. Piotr's transaction
could then be routed to pool 2 instead of reverting. Current receipt checks can
detect that result but cannot undo it.

Operational mitigation is therefore mandatory:

- prepare Piotr's wallet with sufficient ETH and dUSDC before position 99;
- obtain an exact 33 dUSDC allowance immediately before the boundary handoff;
- monitor pool reads, pending/latest nonces, and `PositionJoined`/`PoolLocked`
  events continuously;
- make the handoff immediately after position 99 confirms;
- recheck pool 1 at exactly 99 immediately before Piotr confirms the wallet
  request; and
- stop on any unexpected join, count change, status change, pending nonce, RPC
  disagreement, or stale frontend state.

Residual inclusion risk remains. A deterministic guarantee would require a
reviewed guarded contract function such as
`join(expectedPoolId, expectedActiveCount)` and a new deployment. That is a
separate contract/product decision, not part of this plan.

The current public Demo V1 UI also contains a reversible-test safety guard that
refuses joins once an Open pool is above 89 positions. Therefore it cannot be
used unchanged for the manual 100th join. A narrowly reviewed boundary-test UI
mode or another explicitly authorized manual interface is required first. It
must display the exact pool/count, simulate once, never retry a write, and
verify the actual joined pool and `PoolLocked` receipt semantics.

## Store decision

| Option | Benefit | Risk and decision |
| --- | --- | --- |
| A: extend the existing five-wallet store | Reuses a known encrypted container and five known addresses | Rewrites a completed recovery unit, mixes old nonces and journal history with a new lifecycle, and weakens exact participant auditing. Rejected. |
| B: create a separate 99-wallet store | Clean ordered population, independent backup, manifest, checkpoint, journal, and recovery boundary | Requires a new manually initialized and backed-up artifact set. Recommended. |

Extending the completed five-wallet pilot store would mix a closed reversible
test, existing journal history, funded addresses, and new accumulation state.
It would complicate recovery and make exact participant accounting harder to
audit. Reusing even the first two withdrawn wallets would also add historical
faucet and nonce state without adding useful full-lifecycle coverage.

Use a new external directory and new store ID for exactly 99 fresh addresses.
Its manifest, checkpoint, and journal must be bound to the ordered address
digest and the fixed chain, token, and contract. Creation must remain a manual
PowerShell step with hidden `SecureString` input, independent backup
confirmation, pre/post hashes, no printed secret, and no password in arguments,
environment files, shell history, logs, or chat.

Duplicate joins must be prevented by all of these independent checks:

- one immutable participant index and address per manifest entry;
- one durable journal operation ID for each faucet, approval, and join;
- latest and pending nonce reconciliation before every write;
- zero active position and no prior confirmed join before the first join;
- confirmed receipt sender, calldata, event position owner, actual pool, token
  delta, allowance, participant count, and escrow delta;
- a checkpoint stage that becomes terminal for accumulation after a confirmed
  join; and
- sequential execution with no blind write retries or overlapping ranges.

## Transaction and funding budget

The planned operation count is:

| Scope | Count |
| --- | ---: |
| Fund 99 automatic participant wallets | 99 |
| Automatic faucet + approve + join | 297 |
| Manual wallet faucet + approve + 100th join | 3 |
| Ten draw transactions | 10 |
| Ten winner claim transactions | 10 |
| Lifecycle total, excluding funding | 320 |
| Total including 99 automatic funding transfers | 419 |
| Total including a separate manual-wallet funding transfer | 420 |

There is no withdrawal in the full-lifecycle path.

The successful pilot used 74,750 gas for faucet, 46,330 for approval, and
390,755 for join: 511,835 gas per participant before safety margin. A planning
budget of 150,000 + 46,713 + 400,000 = 596,713 gas, at the observed 11,000,000
wei gas price with a 2x multiplier, is about 0.00001313 ETH per automatic
wallet. This is historical evidence, not a fixed future quote.

Retain the pilot convention of 0.00002 ETH operational amount plus 0.00003 ETH
safety reserve, capped at exactly 0.00005 ETH transferred per automatic wallet,
only if a fresh live estimate remains below that cap. Ninety-nine transfers
would distribute 0.00495 ETH. At the historical gas price, the 99 simple
funding transfers have a 21,000-gas execution lower bound of 0.000022869 ETH,
before OP Stack L1 data fees and volatility. A provisional funding-wallet
planning envelope is therefore approximately 0.006 ETH for the 99-wallet
stage, subject to fresh balance, fee, and aggregate-cap calculations. Piotr's
manual wallet funding remains separate.

Winner claims need their own fresh estimates. In particular, the final claim
also releases 100 positions and may cost materially more than claims 1-9.
Participant reserves must remain untouched until the winner set is known, and
only winning wallets may receive a bounded top-up if a current estimate proves
their reserve insufficient. If Piotr's manual wallet wins, Piotr must claim
manually unless a separately authorized mechanism exists; its key must never be
imported into the 99-wallet operator store.

## Future funding subsystem boundary

Funding should be a distinct testnet subsystem, not another action inside the
participant lifecycle operator. It needs:

- one dedicated disposable Base Sepolia funding wallet, held in a separate
  encrypted store or operating-system keystore;
- no seed, key, or keystore in the repository, `.env`, participant store,
  reports, chat, or general operator logs;
- an immutable binding to exactly the 99 manifest addresses and an exact
  per-wallet transfer cap of 0.00005 ETH;
- a separate funding journal with prepared, nonce-reserved, broadcast,
  confirmed, and manual-review evidence;
- current source balance, destination balance, fee, aggregate amount, and
  aggregate-cap checks before every transfer;
- sequential transfers, low-rate public reads, bounded read-only retry, no
  blind broadcast retry, and conservative restart recovery; and
- a read-only reconciliation report before the lifecycle operator can proceed.

The funding subsystem must not decrypt participant keys. The participant
operator must not accept or instantiate the funding signer.

## Staged execution gates

Each stage is cumulative. A stage may begin only from a clean Git checkpoint,
matching deployment identity, immutable artifact hashes, empty pending-nonce
set, reconciled journal, current backup, and an explicit authorization limited
to that stage.

| Stage | Entry condition | Success evidence | Hard stop |
| --- | --- | --- | --- |
| 5 automatic | New 99-wallet set initialized, backed up, funded only for indices 0-4, pool 1 Open at 0, full dry-run clean | Exactly 5 confirmed faucets, approvals, and joins; pool 1 Open at 5; escrow 165 dUSDC; all five allowances zero; journal and recovery report clean | Any identity/hash mismatch, duplicate or pending nonce, wrong pool, count or escrow delta, ambiguous receipt, unexpected event, or RPC disagreement |
| 20 automatic | Stage 5 reconciled; explicit approval for indices 5-19; live gas/funding checks | Exactly 20 cumulative participants; pool Open at 20; escrow 660 dUSDC; journal/checkpoint consistent; one planned stop and resume proves no rebroadcast | Same stops, plus any operation outside the exact new range or any automatic withdrawal |
| 50 automatic | Stage 20 reconciled; explicit approval for indices 20-49 | Exactly 50 cumulative participants; pool Open at 50; escrow 1,650 dUSDC; RPC pacing, elapsed time, cost, and one controlled interruption/resume are reconciled | Same stops; preserve all evidence before any resume |
| 99 automatic | Stage 50 reconciled; Piotr's manual wallet prepared; boundary monitor active; explicit approval for indices 50-98 | Exactly 99 unique active participants; pool 1 still Open; escrow 3,267 dUSDC; operator hard-stopped with no final-join capability | Stop before 100; stop on any external join, stale read, wrong count, changed pool status, pending nonce, or missing manual handoff readiness |
| Manual 100 | Pool 1 freshly confirmed Open at exactly 99; Piotr wallet has exact allowance, sufficient ETH/dUSDC, zero active position in pool 1; reviewed boundary UI/interface | Receipt proves Piotr's address joined pool 1 as position 100; pool is Locked; escrow 3,300 dUSDC; `lockedAt` and ten scheduled rounds are consistent | Do not submit on stale state. Stop on any pre-confirmation change. If receipt routes elsewhere or is ambiguous, preserve evidence and do not compensate automatically |
| Draws 1-10 | Locked pool, exact schedule recorded, approved executor funded, temporary randomness risk accepted for testnet | One confirmed draw at or after each scheduled time, in order; ten distinct winner positions; after draw 10 pool Claimable; assigned total 3,300 dUSDC | Early/duplicate/out-of-order attempt, unexpected caller or winner mapping, missing event, status/escrow discrepancy, scheduler/RPC disagreement, or ambiguous receipt |
| Claims 1-10 | All winner addresses mapped to controlled participant index or Piotr; each signer independently authorized and funded; live estimate including final release | Each winner receives exactly 330 dUSDC once; claimed total reaches 3,300 dUSDC; final claim makes pool Finished, escrow zero, and all 100 active positions zero | Unknown/unavailable winner key, wrong signer/round, insufficient gas, already-claimed discrepancy, unexpected token delta, failed release, or any ambiguous operation |

After every phase: stop the write process, perform independent public read-only
reconciliation, hash the store/manifest/checkpoint/journal, preserve receipts,
and obtain new authorization. Do not treat completion of one phase as approval
for the next.

## Missing Base Sepolia operator architecture

The repository has useful local lifecycle machinery, but the public guarded
launcher is intentionally limited to two wallets and a reversible
faucet/approve/join/withdraw sequence. The following production-like testnet
capabilities are absent and must remain absent until separately implemented and
reviewed:

- separately authorized real execution and independent-backup validation for
  the prepared exact 99-wallet initializer;
- manifest-bound, capped funding subsystem;
- Base Sepolia accumulation runner with cumulative range gates and hard 99
  stop;
- boundary monitor and special public manual-100 interface (the current UI
  safety margin blocks this use);
- durable scheduled-draw executor with one-round authorization and recovery;
- winner-to-store mapping and per-winner claim runner, including a manual-
  wallet branch and higher final-claim gas handling;
- later network-state expansion of the prepared lifecycle checkpoint for pool
  count, escrow, schedules, winners, assigned/claimed totals, and final
  position release;
- phase-specific read-only reconciliation and evidence export; and
- an explicit incident procedure for external joins, wrong-pool routing,
  ambiguous receipts, unavailable winner keys, and stalled claims.

## Small future tasks

Implement and review these as separate commits and manual checkpoints:

1. **Code prepared 2026-07-19; execution still blocked.** The exact 99-wallet
   initializer and local read-only inspector reuse the encrypted-store
   primitives and create no real store during automated tests. The manual
   launcher and backup gate are documented.
2. **Local artifact foundation prepared 2026-07-27; no real artifacts
   created.** The exact-99 manifest, lifecycle checkpoint, append-only journal,
   and local redacted artifact preflight now bind exactly 99 ordered public
   addresses to one store ID and encrypted-file fingerprint. Fixture tests
   cover the `5 -> 20 -> 50 -> 99` gates, recovery blockers, hard stop, and
   five-wallet pilot compatibility. Live pool capacity, fee ranges, and other
   chain reads remain a later separately authorized network preflight.
3. **Fixture-only code prepared 2026-07-27; execution absent.** The isolated
   exact-99 funding subsystem now binds deterministic wei-only plans to the
   manifest, public signer identity, total/per-wallet caps, signer reserve,
   checkpoint, and append-only journal. Local `plan`, `inspect`, and `simulate`
   modes cover success, failure, timeout, ambiguity, restart, and already-funded
   recipients. No provider, signer credential, funding transport, real plan
   file, or public transfer exists. Real limit selection and funding remain
   later manual stages.
4. Add the Base Sepolia accumulation coordinator for explicitly approved
   cumulative ranges, semantic receipt checks, and an unreachable automatic
   100th join.
5. Add and audit the boundary monitor plus a narrowly scoped public manual-100
   interface. Decide whether residual race risk is acceptable or a guarded
   contract redeployment is required.
6. Add one-round-at-a-time draw planning and execution with schedule gates,
   temporary-randomness warnings, signer funding, and conservative recovery.
7. Add winner mapping and one-claim-at-a-time execution, including manual
   handling for Piotr's wallet and special final-claim estimation.
8. Run the stages only after their own tests, documentation, dry-run, artifact
   backup, exact authorization, and post-phase read-only audit.

The first safe next task is an independent review and Git checkpoint of item 3,
followed by the fixture-only accumulation coordinator in item 4. Eventual
manual store initialization, artifact materialization, inspector verification,
encrypted backup, live gas-based funding limits, RPC preflight, funding, and
every Base Sepolia write remain separately authorized stages.
