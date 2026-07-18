# Base Sepolia read-only operator runbook

## Safety boundary

This command prepares evidence and plans only. It cannot fund wallets, call the
dUSDC faucet, approve, join, withdraw, draw, claim, sign, deploy, or broadcast.
`dry-run` is not a lifecycle execution and does not authorize a future write.
Any 2–5 wallet pilot requires a separate task, independent report review, and
explicit approval. The 100-wallet lifecycle has not been executed.

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
OPERATOR_CHECKPOINT_PATH
OPERATOR_TRANSACTION_JOURNAL_PATH
OPERATOR_REQUIRED_CONFIRMATIONS
```

All three paths must be absolute, outside the repository, non-symlink paths
with the suffixes enforced by the existing durable-state code. The wallet
password is accepted only from the current process environment. Set it
transiently, never in `.env`, GitHub, Vercel, shell history, command arguments,
logs, screenshots, or a report, and clear it after the command. The default
confirmation requirement is 3 blocks.

The operator never calls `openOrCreate`: a missing encrypted store, checkpoint,
or journal is a blocker. It does not automatically generate any wallet.

## Preflight review

Do not continue unless the report confirms all of the following:

- chain ID `84532` and current RPC health;
- bytecode at dUSDC `0xA7FA084b34c888061757d4b5FBb08a7B53fee786`;
- bytecode at POP33 `0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F`;
- exact token linkage and fixed Demo V1 parameters;
- encrypted store integrity, unique ordered addresses, requested range, and
  matching checkpoint/journal project identity;
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

Back up the encrypted wallet store, checkpoint, and journal outside the
repository. Back up the wallet-store password separately. Test decryption and
file integrity on an offline copy before relying on a backup. Never copy
decrypted key material into a report.

On restart, reuse the same files. If the journal contains `prepared`,
`ready_to_broadcast`, `broadcast`, `pending`, or `requires_manual_review`, stop
and reconcile public transaction evidence. Do not create a replacement journal
and do not infer success from nonce changes alone. `failed`, `replaced`, and
`cancelled` remain visible history; a later write decision is out of scope for
this runbook.

## Current checkpoint

The public contract-only preflight succeeds, but this workspace has no
configured external wallet store, checkpoint, or journal. Therefore the
operator currently reports `NOT READY`. Provisioning and reviewing those
artifacts is the next read-only milestone; it is not permission to fund or
operate wallets.
