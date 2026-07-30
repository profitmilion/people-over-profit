# Base Sepolia manual checkpoint 5

Status: preparation only; stop before every wallet signature or transaction

Prepared: 2026-07-30

## For Piotr

Before travelling or starting the later session:

1. Save the public Demo V1 link from this runbook.
2. Prepare two separate existing MetaMask accounts.
3. Record only their public addresses for the read-only checks.
4. Confirm locally that you retain your normal recovery access, but never
   paste a seed phrase, private key, or wallet backup into Codex, ChatGPT, the
   report, or the repository.
5. Confirm that both accounts can switch to Base Sepolia.

## Safety boundary

This runbook prepares a later, separately authorized manual session:

```text
Pool 1 at 3/100
  -> Candidate A: manual exact Approve, then manual Join
  -> verify Pool 1 at 4/100
  -> Candidate B: fresh read-only check, manual exact Approve, then manual Join
  -> verify Pool 1 at 5/100
  -> STOP
```

The preparation task does not create or import wallets, request funds, use a
faucet, load a key, connect MetaMask, sign, approve, join, deploy, or send any
transaction. The two future wallet actions remain manual and require separate
authorization.

> Eligibility is not authorization to execute a transaction.

Never paste a private key, seed phrase, wallet export, RPC credential, or
password into the terminal, report, browser, repository, or chat. Candidate
inputs are public addresses only.

## Prepared public target

| Item | Value |
| --- | --- |
| Network | Base Sepolia, chain ID `84532` |
| POP33 contract | `0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F` |
| dUSDC token | `0xA7FA084b34c888061757d4b5FBb08a7B53fee786` |
| Pool | `1` |
| Entry price | exactly `33` dUSDC (`33000000` base units) |
| Current prepared scenario | `3/100`, `99` dUSDC escrow |
| After Candidate A | `4/100`, `132` dUSDC escrow |
| Hard stop after Candidate B | `5/100`, `165` dUSDC escrow |

The start is calculated from a fresh snapshot; it is not hard-coded into a
session report. The latest preparation snapshot observed Pool 1 at `3/100`, so
the current scenario needs `5 - 3 = 2` Joins. A new public snapshot is
mandatory before any future action. If the fresh start is not exactly `3/100`,
mark this prepared two-Join session `STALE` and recalculate from current state
in a new plan. Never continue from the old calculation.

## Public Preview and mobile route

Use only the public branch Preview:

`https://pop33-demo-git-codex-pop33-recovery-profitmilions-projects.vercel.app/#/demo-v1`

The route was checked without a wallet on desktop and a mobile-sized Android
browser. It loaded without a Vercel login wall or an obvious runtime error. The
page identifies Base Sepolia, shows the connected public address, ETH, dUSDC,
allowance, active positions, pool count and escrow, and keeps exact Approve and
Join as separate actions. A successful receipt exposes a BaseScan link and the
page refreshes semantic state. The UI has a single-flight guard, but that does
not remove on-chain routing or count races.

On mobile, open the route in MetaMask's built-in browser if no injected wallet
is available. Confirm the complete displayed public address before every
action. Do not rely on a shortened address alone.

## 1. Select two candidates

Piotr supplies two existing MetaMask public addresses. This preparation does
not create, import, fund, or configure either wallet.

From PowerShell:

```powershell
$CANDIDATE_A = "0x..."
$CANDIDATE_B = "0x..."

if ($CANDIDATE_A -eq $CANDIDATE_B) {
  throw "STOP: Candidate A and Candidate B must be different public addresses."
}
```

Both addresses must remain distinct after checksum/case-insensitive comparison.
Do not continue if either address is uncertain or if the active MetaMask
account does not exactly match the candidate being checked.

## 2. Create a secret-free session report

Run from `packages/contracts`:

```powershell
$SESSION_ID = "checkpoint-5-YYYYMMDD-HHMM"
$REPORT = "operator-reports\$SESSION_ID.manual-checkpoint-5-report.json"

Copy-Item `
  "..\..\docs\templates\MANUAL_CHECKPOINT_5_REPORT.template.json" `
  $REPORT
```

Generated `*.manual-checkpoint-5-report.json` files are ignored by Git. Record
only public addresses, public block/state evidence, public transaction hashes,
and decisions. Never add secret material. The template is an audit aid; it is
not a transaction runner and does not authorize an action.

## 3. Establish the start snapshot

Run from `packages/contracts`:

```powershell
npm run supervisor -- --exact99-readiness --pool 1
npm run supervisor -- --exact99-readiness --pool 1 --json
```

The session is `BLOCKED` unless all of these are true in one complete pinned
snapshot:

- chain, contract, token, and Pool 1 match the prepared public target;
- Pool 1 is `Open` at exactly `3/100`;
- escrow is exactly `99000000` base units (`99` dUSDC);
- the supervisor reports `WAITING_FOR_PARTICIPANTS`;
- owner mapping is `COMPLETE`, contains three unique active Pool 1 owners, and
  has no warning or critical finding;
- ordered routing reports Pool 1 as the oldest qualifying pool for a genuinely
  new address;
- target `5` requires exactly two more positions and expects `165000000` base
  units of escrow.

Record the block number, block timestamp, plan ID/fingerprint, count, escrow,
supervisor result, owner-mapping fingerprint, routing result, and risks in the
session report.

## 4. Read-only Candidate A check

```powershell
npm run supervisor -- `
  --exact99-readiness `
  --pool 1 `
  --candidate-address $CANDIDATE_A

npm run supervisor -- `
  --exact99-readiness `
  --pool 1 `
  --candidate-address $CANDIDATE_A `
  --json
```

Use these session-level labels:

| Label | Meaning |
| --- | --- |
| `NOT_CHECKED` | No fresh candidate result is recorded. Never proceed. |
| `ELIGIBLE_FOR_MANUAL_JOIN` | The fresh CLI candidate result is `ELIGIBLE`, it routes to Pool 1, it has no active Pool 1 position, it is below the global active-position limit, and all start checks remain exact. |
| `INELIGIBLE` | The address already owns a Pool 1 position, has reached the global active-position limit, is malformed, duplicates the other candidate or an active owner, or otherwise fails candidate rules. |
| `ROUTES_TO_DIFFERENT_POOL` | `findOldestQualifyingPool` selects another pool or an earlier qualifying pool exists. |
| `STALE` | Count, state, owners, plan age, or another bound assumption changed after the recorded snapshot. |
| `INCOMPLETE` | RPC, owner mapping, routing, or candidate evidence is missing or contradictory. |

The positive label is a documented interpretation of the existing read-only
CLI result. It does not add or invoke a write path.

Also verify in the UI, without clicking a transaction button, that Candidate A
is the connected account, is on Base Sepolia, has at least `33` dUSDC available
for the entry, shows either zero or exactly `33` dUSDC allowance as appropriate
to the next safe step, and has enough test ETH for the later separately
authorized exact Approve and Join. Any higher or otherwise unexpected
allowance is a hard stop. If any resource is missing, stop; this runbook does
not fund the address or use the faucet.

### Freshness rule

A candidate check is only point-in-time evidence for its displayed block. Run
the final read-only check immediately before opening the wallet confirmation
flow, with a practical maximum age of 60 seconds. Re-run it after any delay.
Any observed block-dependent count, status, escrow, owner, candidate, or
routing change invalidates the earlier result. A fresh result reduces risk but
cannot bind the later `join()` call to an expected pool or count.

### Future separately authorized manual action A

This preparation stops before this action. In a later authorized session,
Candidate A would manually:

1. confirm Base Sepolia and the complete account address;
2. approve exactly `33` dUSDC as a separate transaction, if the exact allowance
   is not already present;
3. wait for the approval receipt and refreshed exact allowance;
4. click Join once;
5. reject any unexpected contract, network, amount, account, or wallet prompt.

Never retry an ambiguous or pending transaction. Record the public hash and
inspect its receipt before deciding what happened.

## 5. Validate the expected `4/100` checkpoint

Only after a confirmed future Join A, run:

```powershell
npm run supervisor -- --exact99-readiness --pool 1
npm run supervisor -- --exact99-readiness --pool 1 --json
```

Continue to Candidate B only if:

- Pool 1 is still `Open` at exactly `4/100`;
- escrow is exactly `132000000` base units (`132` dUSDC);
- Candidate A is an active Pool 1 owner;
- owner mapping is `COMPLETE` with four unique active owners;
- the supervisor remains `WAITING_FOR_PARTICIPANTS`;
- no warning, critical inconsistency, external unexpected Join, ambiguous
  receipt, or routing mismatch exists.

Otherwise record the precise `STALE`, `INCOMPLETE`, routing, eligibility, or
other blocking reason and stop. Do not compensate with another transaction.

## 6. Fresh read-only Candidate B check

Candidate B must be checked again after Join A; its earlier result is stale by
definition.

```powershell
npm run supervisor -- `
  --exact99-readiness `
  --pool 1 `
  --candidate-address $CANDIDATE_B

npm run supervisor -- `
  --exact99-readiness `
  --pool 1 `
  --candidate-address $CANDIDATE_B `
  --json
```

Candidate B is `ELIGIBLE_FOR_MANUAL_JOIN` only when:

- the fresh CLI candidate result is `ELIGIBLE` and routes to Pool 1;
- Pool 1 remains exactly `Open` at `4/100` with `132` dUSDC escrow;
- Candidate B differs from Candidate A and all four mapped active owners;
- Candidate B has no active Pool 1 position and remains below the global
  active-position limit;
- owner mapping is complete and all other start/routing checks remain clean;
- the UI read-only values show the matching Candidate B account, at least
  `33` dUSDC, and enough test ETH.

Apply the same 60-second freshness rule. Record any mismatch with the precise
non-positive status above and stop.

### Future separately authorized manual action B

This preparation stops before this action. In a later authorized session,
Candidate B would use the same exact Approve-then-Join sequence as Candidate A,
with one Join attempt maximum and no automatic retry.

## 7. Validate `5/100` and hard stop

Only after a confirmed future Join B, run:

```powershell
npm run supervisor -- --exact99-readiness --pool 1
npm run supervisor -- --exact99-readiness --pool 1 --json
```

The expected final checkpoint is:

- Pool 1 `Open` at exactly `5/100`;
- escrow exactly `165000000` base units (`165` dUSDC);
- five unique mapped active Pool 1 owners including Candidates A and B;
- supervisor `WAITING_FOR_PARTICIPANTS`;
- next checkpoint calculation starts from the new count.

Record the final public state, then **STOP**. Do not approve or join from a
third address. Do not continue toward 20, 50, 99, or 100 in this session.

Also stop immediately if the count is already `5` or greater, the pool is not
`Open`, escrow differs from `count * 33` dUSDC, routing changes, a receipt is
ambiguous, or any warning/critical result appears.

Emergency-stop conditions also include:

- MetaMask shows a different network, account, contract, token, or amount;
- a Join receipt indicates a different pool;
- a transaction hash exists but its receipt is unknown;
- an external address changes the count between checks;
- Candidate B loses qualification after Candidate A;
- the UI enables another Join while an action is pending;
- allowance, balance, refreshed count, active position, or escrow does not
  match the expected public state.

Do not try to repair any of these conditions by clicking Approve or Join again.

## Preparation result

At preparation time:

- Candidate A: `NOT_CHECKED`;
- Candidate B: `NOT_CHECKED`;
- manual Approve transactions: not performed;
- manual Join transactions: not performed;
- wallets, keys, funding, faucet calls, deployment, and blockchain
  transactions: not performed.

The only safe continuation is to supply two distinct public MetaMask addresses
and run the candidate checks above.
