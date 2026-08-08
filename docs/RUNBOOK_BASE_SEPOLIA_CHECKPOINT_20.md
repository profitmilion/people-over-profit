# Base Sepolia guarded checkpoint 20

Status: implementation prepared for review; **EXECUTE IS NOT AUTHORIZED**.

This runbook covers a baseline-aware continuation of Pool 1 from the verified
`5/100` manual checkpoint to a future hard stop at `20/100`. It does not
authorize wallet creation, funding, faucet, approval, Join, or any other public
transaction.

## Fixed scope

- network: Base Sepolia, chain ID `84532`;
- POP33: `0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F`;
- dUSDC: `0xA7FA084b34c888061757d4b5FBb08a7B53fee786`;
- pool: `1`;
- baseline: five existing positions not owned by this runner;
- runner candidates: exactly 15 new unique public addresses, indices `0..14`;
- hard stops: `10/100`, `15/100`, and `20/100`;
- funding cap: `0.00005 ETH` per candidate, `0.00075 ETH` total;
- entry price and escrow delta: exactly `33` dUSDC.

The runner never recreates or claims ownership of the first five positions.
Candidate indices map to pool counts as follows:

| Candidate indices completed | Expected Pool 1 | Expected escrow |
| --- | ---: | ---: |
| none | `5/100` | `165` dUSDC |
| `0..4` | `10/100` | `330` dUSDC |
| `0..9` | `15/100` | `495` dUSDC |
| `0..14` | `20/100` | `660` dUSDC |

## Modes

Run from `packages/contracts`.

### PLAN

```powershell
npm run operator:base-sepolia:checkpoint-20 -- --plan
```

This is the default launcher mode. It performs no RPC call, creates no wallet
or artifact, loads no key, and prints only the fixed baseline, batches,
operation order, store requirement, and funding limits.

### INSPECT

```powershell
npm run operator:base-sepolia:checkpoint-20 -- --inspect
```

This connects through public-read clients only. It pins a Base Sepolia block,
reuses the lifecycle supervisor and exact-99 readiness, checks canonical
runtime bytecode hashes, Pool 1 count/escrow/lock state, all lifecycle
diagnostics, faucet constants, and the public funding-address balance.

An optional public candidate address enables candidate reads and unsigned
estimates:

```powershell
npm run operator:base-sepolia:checkpoint-20 -- `
  --inspect `
  --candidate 0xPUBLIC_ADDRESS
```

Unsigned estimation is best-effort and state-dependent. An unavailable Join
estimate must not be replaced with an invented value.

### SIMULATE

```powershell
npm run operator:base-sepolia:checkpoint-20 -- --simulate
```

This uses 15 deterministic public fixture addresses and no wallet material. It
simulates the complete candidate state machine, stops at `10`, resumes to `15`,
then resumes to the final `20` hard stop. It has no provider, signer, RPC write,
or transaction transport.

### EXECUTE

**EXECUTE IS NOT IMPLEMENTED OR AUTHORIZED IN THIS MILESTONE.**

`--execute` is rejected by the CLI before the Hardhat command starts. The
launcher accepts only `Plan`, `Inspect`, and `Simulate`. No environment private
key is accepted, and the implementation contains no wallet client,
`sendTransaction`, or `writeContract` path.

## Safe PowerShell launcher

Double-clicking or running the launcher without parameters selects `Plan`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/run-guarded-checkpoint-20.ps1
```

Explicit read-only inspection:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/run-guarded-checkpoint-20.ps1 `
  -Mode Inspect
```

The launcher has no `Execute` value.

## Future store boundary

No real store exists or is created by these commands. A later authorized task
must provide an external, production-strength store v2 with exactly one
selected record decrypted per signer session. The public manifest contains
only 15 ordered addresses and binds:

- chain, contract, token, pool, baseline, and target;
- external store UUID and public fingerprint;
- selected-record-decryption capability;
- immutable address order and manifest fingerprint.

The fixture/local implementation and its remaining real-store review gates are
documented in `docs/RUNBOOK_WALLET_STORE_V2.md`. It adds no signer, wallet
client, execution mode, or transaction capability.

The journal rejects secret-shaped field names. Private keys, mnemonics, seed
phrases, passwords, credentials, and RPC secrets must never appear in the
manifest, journal, report, CLI arguments, repository, or chat.

## Candidate state machine

One candidate and one operation at a time:

`PRECHECK -> FUND -> VERIFY_FUNDING -> FAUCET -> VERIFY_DUSDC ->`
`APPROVE_EXACTLY_33 -> VERIFY_ALLOWANCE -> JOIN -> VERIFY_RECEIPT ->`
`POSTFLIGHT -> COMMIT_JOURNAL_STATE`

The durable journal uses a checksum, monotonic revision, manifest binding,
atomic private-file replacement, and an exclusive filesystem lock. On restart,
the future public executor must reconcile the latest and pending nonce,
transaction hash/receipt/finality, and current blockchain state before
advancing. A pending, ambiguous, failed, or manual-review entry blocks the next
step. Blind transaction retry is forbidden.

## Hard stops

The implemented guard rejects at least:

- wrong chain, contract, token, or runtime bytecode;
- pool not Open, count outside `5..20`, wrong escrow, or non-zero `lockedAt`;
- lifecycle actionable operation, warning, or critical diagnostic;
- RPC-source disagreement;
- manifest/store fingerprint mismatch or global lock conflict;
- latest/pending nonce mismatch or manual nonce conflict;
- invalid, duplicate, previously used, ineligible, or wrong-routed candidate;
- insufficient ETH, fee-cap breach, funding cap breach, or signer-reserve
  violation;
- faucet cooldown or drip other than `330` dUSDC;
- non-zero initial allowance, approval other than `33` dUSDC, or post-approval
  allowance other than `33` dUSDC;
- reverted, pending, ambiguous, or reorged receipt;
- wrong joined Pool ID, position delta other than `+1`, count delta other than
  `+1`, or escrow delta other than `+33` dUSDC;
- any operation after candidate index 14 or after `20/100`.

## Required future execution gate

A later task may design an execution adapter only after independent review.
It must require a separate `--execute` mode, exact checkpoint-specific intent,
external selected-record store, durable journal path, funding-signer identity,
fee policy, two independent RPC sources, and explicit authorization for one
batch only. Without all gates it must not load or request any secret.

Completion of implementation review does not authorize creation of wallets or
the first funding transaction.
