# Base Sepolia read-only operator runbook

## Safety boundary

This command prepares evidence and plans only. It cannot fund wallets, call the
dUSDC faucet, approve, join, withdraw, draw, claim, sign, deploy, or broadcast.
`dry-run` is not a lifecycle execution and does not authorize a future write.
Any 2–5 wallet pilot requires a separate task, independent report review, and
explicit approval. The 100-wallet lifecycle has not been executed.

## Manual initialization of the five-wallet pilot set

The reviewed initializer created exactly five new test wallets and four bound
files outside the repository. It did not fund them and cannot send a
transaction. The external set was later funded for the guarded scope, and its
two-wallet write pilot completed successfully on 2026-07-18.

Piotr runs this manually from PowerShell:

```powershell
Set-Location -LiteralPath 'D:\piotr\Documents\pop33-ui-codex'
powershell -NoProfile -ExecutionPolicy Bypass -File '.\packages\contracts\scripts\initialize-base-sepolia-pilot-5.ps1'
```

The default target is:

```text
%LOCALAPPDATA%\POP33\operator\base-sepolia-pilot-5
```

The script displays only the project, network, chain ID, wallet count, target
directory and safety boundary. It requires the exact confirmation
`CREATE POP33 BASE SEPOLIA PILOT 5`, then requests the new password twice with
PowerShell `SecureString` prompts. The password is never a CLI argument and is
not added to the PowerShell process environment. It is inserted only into a
dedicated child `ProcessStartInfo` environment, removed from that object after
launch and again during cleanup, and the unmanaged BSTR buffers are zeroed.
Private keys and encrypted contents are never printed.

Initialization refuses a target inside the worktree or any pre-existing target
directory. It creates the complete set in a temporary sibling directory,
validates decryption, count, uniqueness, store ID, ordered-address digest,
checkpoint, empty journal and manifest, and only then renames the directory to
its final location. A failure removes only that validated temporary directory.

The final directory contains:

- `pilot-5.operator-wallets.enc.json` — AES-256-GCM/scrypt wallet store;
- `pilot-5.operator-checkpoint.json` — version 2 checkpoint with five ordered
  public addresses and the shared binding;
- `pilot-5.operator-journal.json` — version 2 empty transaction journal with
  the same binding;
- `pilot-5.operator-set-manifest.json` — non-secret project, purpose, chain,
  deployment, wallet count, store ID, creation time, ordered addresses and file
  mapping.

The pilot set is testnet-only and is not a production wallet set. A future
100-wallet set must use another directory, another store ID, another manifest,
and a separately reviewed initialization stage.

Run from `packages/contracts`:

```text
npm run operator:base-sepolia:read-only -- preflight --wallet-count 2
npm run operator:base-sepolia:read-only -- status --start-index 0 --wallet-count 5
npm run operator:base-sepolia:read-only -- plan --start-index 0 --wallet-count 100
npm run operator:base-sepolia:read-only -- dry-run --start-index 0 --wallet-count 2 --format both
```

Allowed modes are exactly `preflight`, `status`, `plan`, and `dry-run`.
`--start-index` is zero-based, `--wallet-count` accepts 1–100, and the selected
range cannot exceed index 99. Output format is `text`, `json`, or `both`.

## Runtime configuration

The public RPC defaults to `https://sepolia.base.org`. Override it only with a
credential-free HTTPS URL:

```text
BASE_SEPOLIA_OPERATOR_RPC_URL
OPERATOR_WALLET_STORE_PATH
OPERATOR_WALLET_STORE_PASSWORD
OPERATOR_SET_MANIFEST_PATH
OPERATOR_CHECKPOINT_PATH
OPERATOR_TRANSACTION_JOURNAL_PATH
OPERATOR_REQUIRED_CONFIRMATIONS
```

All four paths must be absolute, outside the repository, non-symlink paths
with the suffixes enforced by the existing durable-state code. The wallet
password is accepted only from the current process environment. Set it
transiently, never in `.env`, GitHub, Vercel, shell history, command arguments,
logs, screenshots, or a report, and clear it after the command. The default
confirmation requirement is 3 blocks.

The read-only operator never calls `openOrCreate`: a missing encrypted store,
manifest, checkpoint, or journal is a blocker. Only the separately confirmed
manual initializer may create the five-wallet set.

### Public RPC rate limits

Every public chain read and read-only gas estimate uses one shared bounded
rate-limit policy. It recognizes JSON-RPC `-32016`, the commonly used
rate-limit code `-32005`, explicit rate-limit/throttling messages, and HTTP
`429` when the provider exposes it. Non-rate-limit failures are never retried.

The policy permits at most five attempts. Delays start at 500 ms, double up to
4 seconds, and add at most 20% jitter. Each retry prints only a sanitized
operation label, next attempt number, bounded delay, and redacted error. After
the fifth failed attempt the operator hard-stops and preserves the final
failure. Contract identity mismatches, wrong passwords, corrupt artifacts,
reverts, and other non-transient errors stop immediately.

Global reads, contract identity fields, rounds, wallet fields, latest/pending
nonces, and gas estimates are requested sequentially. Public execution also
paces successive wallets by 200 ms. Retry never signs or broadcasts and never
modifies the wallet store, manifest, checkpoint, or journal.

## Preflight review

Do not continue unless the report confirms all of the following:

- chain ID `84532` and current RPC health;
- bytecode at dUSDC `0xA7FA084b34c888061757d4b5FBb08a7B53fee786`;
- bytecode at POP33 `0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F`;
- exact token linkage and fixed Demo V1 parameters;
- encrypted store integrity, unique ordered addresses, requested range, and a
  matching manifest/checkpoint/journal project identity and store ID;
- no prepared, ready-to-broadcast, broadcast, pending, ambiguous, or
  manual-review operation;
- required confirmation depth for confirmed journal transactions;
- `readOnly: true` and `READ_ONLY_NO_SIGNING_NO_BROADCAST`.

Any mismatch is a stop condition. Do not repair a mismatch by deleting or
replacing a state file. Preserve it for investigation.

## Status and dry-run review

For each selected wallet review ETH and dUSDC balances, latest/pending nonce,
exact allowance, faucet cooldown, active-position count and ID, claimable
amount, journal states, planned actions, and blockers. Review the current gas
price, live estimates, estimated wei cost, the visible 2x reserve multiplier,
and aggregate lifecycle reserve. `NOT CURRENTLY ESTIMABLE` means the live state
does not yet permit a reliable estimate; the report states the prerequisite.
It must never be replaced by an invented gas value.

Running the same dry-run against unchanged chain state and unchanged artifacts
must produce the same wallet decisions. Timestamps and latest block metadata
may naturally advance. Nonces, allowance, balances, and contract state must
not change because of the command.

## Backup and recovery

Back up the entire four-file directory as one unit outside the repository. Back
up the wallet-store password separately. Loss of the encrypted store or its
password means loss of access to the five wallets; the store alone is not
enough. Never copy decrypted key material into a report.

Create the backup only with a locally reviewed encryption tool or an encrypted
volume. For example, use the 7-Zip GUI with AES-256, `Encrypt file names`
enabled, and a separately entered backup password; do not place a password in a
command argument. Do not upload the directory or archive to GitHub or any cloud
service automatically.

To verify a backup, restore its four files into a separate external test
directory, point the read-only operator variables at that copy, enter the
wallet-store password only through a protected temporary PowerShell process,
and run `preflight`. Integrity is confirmed only when AES-GCM decryption,
manifest, store ID, ordered-address digest, checkpoint and empty/reconciled
journal all validate. This check prints no private keys.

On restart, reuse the same files. If the journal contains `prepared`,
`ready_to_broadcast`, `broadcast`, `pending`, or `requires_manual_review`, stop
and reconcile public transaction evidence. Do not create a replacement journal
and do not infer success from nonce changes alone. `failed`, `replaced`, and
`cancelled` remain visible history; a later write decision is out of scope for
this runbook.

## Current checkpoint

Piotr manually created the external five-wallet pilot set. A public Base
Sepolia preflight for the first two wallets succeeded with all artifact checks
`OK`, chain `84532`, range `2/2`, zero balances and nonces, an empty journal,
and no signature or broadcast. The following five-wallet `status` read stopped
when the public RPC returned `-32016: over rate limit` for pending nonce.

Bounded retry, exponential backoff, jitter, sequential reads, and 200 ms wallet
pacing are now implemented. Piotr subsequently completed `status` for five and
`dry-run` for two and five. The four artifacts were byte-for-byte unchanged and
no transaction was signed or broadcast.

The separately guarded write pilot for wallet indices 0 and 1 completed
successfully on 2026-07-18. Its funding, authorization, execution, receipts,
and recovery evidence are recorded in
`docs/RUNBOOK_BASE_SEPOLIA_PILOT_2_WRITE.md`. That completed reversible pilot
does not authorize reuse of the five-wallet set or any future lifecycle write.
