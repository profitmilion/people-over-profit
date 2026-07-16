# Scripts

## Local-only commands

- `npm run deploy:dry-run` deploys `Pop33DemoUSDC` and `Pop33BasicV1` to a fresh
  simulated `hardhatOp` network and validates the initial configuration.
- `npm run smoke:demo-v1` independently deploys the same local contracts and
  exercises 100 faucet drips, 100 joins, ten draws, ten claims, and `Finished`
  settlement.
- `npm run operator:local:lifecycle` deploys a fresh pair and runs the guarded
  multi-wallet operator lifecycle: 100 drips and exact approvals, a hard stop
  at 99, complete withdrawal while Open, refill to 99, a separately confirmed
  final join, ten scheduled draws, ten winner-authorized claims, and final
  escrow/position reconciliation.

Both commands select the local network inside the script, require no external
RPC, and never write a frontend contract address.

## Local multi-wallet operator

The modular implementation is under `scripts/operator`. `DemoV1Operator`
exposes the following modes, which all share receipt checks, post-state
validation, and checkpoint updates:

| Mode | Behavior |
| --- | --- |
| `preflight` | Reads chain ID, both addresses and bytecode, token decimals/linkage, pool parameters and every wallet's public balances and allowance. |
| `status` | Reconciles and returns pool, escrow, draw/claim progress and public wallet state. |
| `fund` | Assigns local Hardhat ETH only. |
| `drip` | Simulates each faucet call, waits for its receipt and checks the token delta. |
| `approve` | Simulates and sets exactly one entry-price allowance, then checks it on-chain. |
| `join-to-99` | Joins sequentially, validates every transition, checkpoints every receipt and cannot cross 99/100. |
| `final-join` | Requires a phrase generated from the actual network, chain ID, pool ID and `99/100`, then rechecks Open status, escrow, all 100 wallet memberships, allowance, the final position/event and the complete locked draw schedule. |
| `withdraw-all-before-lock` | Runs only while Open and stops at the first refund, membership or escrow mismatch. |
| `draw-next` | Executes exactly one due sequential round and verifies a new unique winner. |
| `claim-finalized` | Maps finalized winners to their actual local signer and verifies every payout and accounting change. |

`local-lifecycle.ts` is the repeatable invariant-driven orchestration of those
modes. Its 100 wallets are still generated randomly in memory for disposable
local tests. Its transaction path now runs through the same idempotency and
journal coordinator as the durable foundation, using a memory journal because
the simulated chain itself disappears with the process.

Checkpoints use an explicit non-secret schema containing only public wallet
indexes/addresses, pool and position IDs, stages, nonces, transaction hashes,
receipt data, balances, allowance, and draw/claim results. The JSON store writes
atomically, requests owner-only file permissions where the platform supports
them, rejects unknown fields, and validates every field's type, range and
semantic format. It also rejects credential URLs, PEM keys, mnemonic-shaped
values, keystore structures and secret labels. A 32-byte transaction hash is
not heuristically distinguishable from arbitrary 32-byte material, so every
stored transaction is additionally resolved through the provider during
resume and checked for sender, nonce, target, receipt and called function.
Checkpoint filenames are ignored by Git. A resumed operator validates chain,
contract, token, pool and wallet identities, then reconciles every wallet with
live state before continuing; it does not blindly trust its last stage.

The JSON checkpoint path must be absolute, end with
`.operator-checkpoint.json`, remain outside the repository, and contain no
symlink or redirected path component. Existing ordinary or corrupted files are
never overwritten. The current local lifecycle does not need this store and
continues to use `MemoryCheckpointStore`.

## Durable wallet and transaction foundation

`EncryptedWalletProvider` creates wallets once and stores their private keys in
one authenticated encrypted file. The versioned envelope uses AES-256-GCM,
scrypt (`N=16384`, `r=8`, `p=1`), a new random salt and a new random 96-bit IV
for every write. Addresses and private keys are inside the ciphertext. The GCM
authentication tag detects a wrong password, corruption, or modification.
The target path comes only from `OPERATOR_WALLET_STORE_PATH`; it must be
absolute, outside the repository, and end with `.operator-wallets.enc.json`.
The password is requested through the runtime password-reader boundary and has
no environment variable. The file is written through a synced temporary file,
an atomic rename, and owner-only permissions where supported.

The encrypted file and its password are both required to recover the wallets.
Losing the file or password means losing access to those wallets. Store them
separately in controlled locations. Never put either secret in GitHub, Vercel,
logs, command-line arguments, `.env`, or any `VITE_*` variable.

`JsonTransactionJournal` is a separate non-secret, versioned file selected by
`OPERATOR_TRANSACTION_JOURNAL_PATH`. It stores public operation meaning,
reserved nonce, transaction hash, receipt summary, timestamps, sanitized error
text, and these explicit states: `prepared`, `ready_to_broadcast`, `broadcast`,
`pending`, `confirmed`, `failed`, `replaced`, `cancelled`, and
`requires_manual_review`. Its deterministic idempotency key hashes the action,
scope, wallet, chain, contracts, pool/round, and a canonical parameter digest.
Repeating the same semantic operation returns the existing record instead of
creating another one.

Before a transaction is sent, the operator persists its intent and reserved
nonce. It persists the returned hash before waiting for a receipt. On restart,
a confirmed record is revalidated against the provider; a newly found
successful receipt is reconciled to `confirmed`; an existing transaction stays
`pending`; a discoverable same-nonce replacement or cancellation is marked
explicitly. A reserved nonce without a hash, a missing transaction with
inconclusive provider evidence, and every other ambiguous outcome become
`requires_manual_review`. Confirmed, pending, replaced, cancelled, failed, and
manual-review records cannot be automatically broadcast again. Journal writes
use the same synced temporary-file and atomic-rename pattern. A short-lived
process-owned lock and revision comparison reject concurrent writers instead
of silently losing an operation.

`openDurableOperatorState()` opens the encrypted wallets and matching journal
together. This is a preparatory API, not a public-network command. There is no
CLI that enables Base Sepolia writes, no password environment variable, and no
automatic manual-review resolution in this checkpoint.

All Base Sepolia writes are blocked in this version. The policy already reserves
three future gates (the exact `baseSepolia` network, a separate execution flag,
and an exact confirmation phrase), but deliberately aborts even when all three
are supplied. Read-only modes remain structurally separate from writes.

Safety warning: once a pool reaches 100/100 it becomes Locked atomically. There
is no withdrawal path and no administrator rescue after that point. The current
contract reaches Finished only after ten due permissionless draws and all ten
winner wallets claim successfully. Do not adapt this operator to a public
network until funded-gas preflight, provider-specific replacement discovery,
bounded receipt timeouts, independent review, and an explicit public runbook
are complete. The public race
between simulation and mining cannot be fully bound to an expected pool with
the current `join()` interface; solving that requires a future contract-level
expected-pool/count guard and a separately reviewed deployment.

## Base Sepolia commands

- `npm run deploy:base-sepolia` and the explicit alias
  `npm run deploy:base-sepolia:external-token` retain the existing one-contract
  path using a previously deployed external six-decimal token.
- `npm run deploy:base-sepolia:demo-token` prepares two sequential deployments:
  POP33 Demo USD (`dUSDC`) and then `Pop33BasicV1`. It checks chain ID `84532`,
  a conservative native-token reserve, exact fixed parameters, deployed
  bytecode and state, and two separate confirmation phrases. The second phrase
  is checked again immediately before the second transaction.

The dUSDC pair deployment recorded in `../../../docs/DEMO_V1.md` has already
occurred. Do not rerun this command for that version: the script starts by
deploying another token and is not a resume command. During the recorded run,
a transient RPC read after the successful token receipt stopped execution
before POP33; the existing token was independently verified and only the
second deployment was resumed. Any future run requires a new explicit version
decision and duplicate-deployment review.

These commands do not load `.env` files automatically, print secrets, update
frontend configuration, or verify the contract in an explorer. Required
preconditions and the deployment register are documented in
`../../../docs/DEMO_V1.md`.
