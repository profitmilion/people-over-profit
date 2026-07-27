# Base Sepolia exact-99 funding subsystem

Status: fixture-only planning, inspection, and simulation prepared; no public
funding runner

Prepared: 2026-07-27

## Simple purpose

Each of the future 99 operator wallets will need a small amount of valueless
Base Sepolia ETH to pay gas for its own faucet, approval, join, and possible
claim transactions. This subsystem prepares the safety rules before any ETH is
sent.

A funding plan is not a transfer. It is a deterministic local description of
the only 99 allowed recipients, the proposed wei amount for each recipient,
the maximum per-wallet amount, the maximum total budget, and the reserve that
must remain on the funding wallet. This code has no provider, private key,
signer, RPC connection, or transaction transport.

## Artifact identity

The plan can be built only from the validated exact-99 manifest. It inherits:

- set ID and store ID;
- manifest SHA-256 fingerprint;
- ordered-address digest;
- exactly 99 public addresses in indices `0-98`; and
- the Base Sepolia chain ID and recorded POP33 lifecycle purpose.

Callers cannot replace the manifest with an arbitrary CLI address list. A
missing, extra, duplicate, reordered, or foreign address invalidates the plan.
Each operation ID is deterministic for the manifest, index, address, amount,
and minimum target balance.

## Wei-only limit profile

Every monetary configuration value is a canonical unsigned decimal wei
string. JavaScript numbers and values containing `ETH`, `gwei`, decimals,
signs, or other unit labels are rejected. This avoids accidental multiplication
or division by `10^9` or `10^18`.

The configurable limits are:

- planned amount per wallet;
- minimum target balance;
- maximum amount per wallet;
- maximum total budget for all 99 recipients; and
- required signer reserve.

The public signer identity also binds its expected address, chain ID, funding
purpose, maximum budget, fixture starting balance, and required reserve. It
contains no credential.

The automated tests use illustrative fixture values only: 0.00005 ETH planned
per wallet, a 0.0001 ETH per-wallet ceiling, a 0.01 ETH total ceiling, and a
0.001 ETH signer reserve. These values are not approved operating or business
constants. Before any real test, proposed values must be recalculated from
fresh gas estimates for the exact action set, current Base Sepolia fee data,
claim probability, retry policy, and a separately reviewed safety multiplier.

The plan is rejected when:

- any value is zero, negative, malformed, or has an ambiguous unit;
- the planned amount is below the minimum target or above the wallet ceiling;
- the sum for 99 wallets exceeds the total ceiling;
- the fixture signer balance cannot cover the plan; or
- completing the plan would reduce the signer below its required reserve.

## Local modes only

`packages/contracts/scripts/operator/exact-99-funding.ts` exposes only:

- `plan`: builds and renders the immutable deterministic 99-recipient plan;
- `inspect`: checks the plan against manifest, checkpoint, and append-only
  journal; and
- `simulate`: applies fixture outcomes without a provider or real transaction.

There is deliberately no `execute`, `send`, `fund`, or `broadcast` mode.

## Journal and recovery

Funding uses the existing exact-99 append-only journal. Its operation lifecycle
is:

`planned -> prepared -> pending -> confirmed`

Terminal or stopping outcomes are `failed`, `ambiguous`, `manual-review`, and
`skipped-already-funded`.

Forward-only transition checks prevent a confirmed or failed operation from
moving backwards. Once a transaction hash is recorded for one operation, it
cannot change. A confirmed or already-funded wallet is skipped on restart and
cannot be funded automatically a second time.

Before simulation resumes, local inspection reconciles manifest, plan,
checkpoint, and the latest journal event for every funding operation. Pending,
ambiguous, manual-review, and failed work blocks automatic continuation.
Simulation stops on the first such outcome. The checkpoint `funded` counter is
required to equal the number of uniquely confirmed funding operations.

## Exact-99 preflight integration

The combined local preflight checks:

- store, manifest, checkpoint, and journal identity;
- all 99 recipients and their order;
- deterministic operation identities;
- per-wallet and total budgets;
- signer identity, starting balance, and reserve;
- absence of foreign or duplicate recipients;
- latest journal recovery states; and
- checkpoint/journal confirmed-funding reconciliation.

Reports abbreviate public signer and recipient addresses and contain no secret.
They perform no live chain read.

## Authorization boundary and next step

This stage created no real plan file, wallet store, wallet, signer, funding
transaction, or Base Sepolia connection. It does not authorize ETH transfer.

After independent review and a clean Git checkpoint, the next engineering task
is a fixture-only accumulation coordinator for the cumulative
`5 -> 20 -> 50 -> 99` stages. Real store initialization, artifact backup, live
gas-based limit selection, public RPC preflight, funding, and every lifecycle
write remain separate explicit authorizations.
