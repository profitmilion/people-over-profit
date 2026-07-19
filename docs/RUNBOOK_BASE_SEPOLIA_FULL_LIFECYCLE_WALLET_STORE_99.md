# Base Sepolia full-lifecycle 99-wallet store tools

Status: code and fixture tests prepared; real store not initialized

Prepared: 2026-07-19

Network identity: Base Sepolia (`84532`), with no RPC use in these tools

## Authorization boundary

This runbook documents a future initializer and a local read-only inspector.
It does not authorize `Initialize` mode. Preparing or testing this code does
not authorize wallet creation, funding, signing, broadcast, faucet use,
approval, join, withdrawal, draw, claim, deployment, or a Vercel change.

The real 99-wallet store has not been created. No wallet has been funded and no
transaction was performed for this checkpoint.

## Isolation and file identity

The tool accepts one external target directory and uses exactly one fixed file
name inside it:

`full-lifecycle-99.operator-wallets.enc.json`

The directory must be outside the repository. The file name differs from the
five-wallet pilot store, and the tool never reads, imports, migrates, extends,
or overwrites that pilot. It also does not create a manifest, checkpoint, or
transaction journal. Those artifacts belong to later, separately reviewed
operator stages.

The store reuses format version 1 from the existing durable operator-wallet
implementation: scrypt with the existing fixed parameters derives a 256-bit
key, and AES-256-GCM provides authenticated encryption with a random salt and
IV. No second encrypted-store format was introduced.

## Modes

Run commands from `packages/contracts`. Replace `<external-directory>` with a
reviewed absolute directory outside the repository. Never place a password in
the command, an environment file, shell history, Git, a log, or chat.

### Dry-run (safe current mode)

```powershell
npm run operator:base-sepolia:wallet-store-99 -- -Mode DryRun -TargetDirectory "<external-directory>"
```

Dry-run prints only the planned file, the fixed count of 99, whether the target
exists, and the enforced safeguards. It does not prompt for a password, create
a directory or file, generate a wallet, load key material, or connect to RPC.

### Initialize (future separate authorization only)

```powershell
npm run operator:base-sepolia:wallet-store-99 -- -Mode Initialize -TargetDirectory "<external-directory>"
```

Do not run this mode without a new explicit authorization. It requires the
case-sensitive phrase:

`CREATE POP33 BASE SEPOLIA FULL LIFECYCLE 99`

It then collects the new password twice through hidden `SecureString` prompts.
The child process receives the values only at runtime, removes them from its
environment, and never prints them. The initializer rejects every wallet count
other than 99 and refuses an existing target.

Creation uses a private temporary encrypted file, reopens and authenticates it,
validates the exact wallet count, index order, address/private-key integrity,
and uniqueness, then performs the final rename. A failure removes the temporary
file. Neither the plaintext nor the encrypted payload is logged.

### Inspect (only after a future initialization)

```powershell
npm run operator:base-sepolia:wallet-store-99 -- -Mode Inspect -TargetDirectory "<external-directory>"
```

The inspector opens the existing store locally and read-only. It prints only:

- format version and non-secret store ID;
- wallet count;
- public index/address pairs;
- SHA-256 fingerprint of the encrypted file;
- missing/invalid and duplicate-address findings;
- exact-99 and structural-validation results; and
- `createdAt` as unavailable because store format version 1 does not retain it.

It never returns or prints a private key, mnemonic, password, derived key,
plaintext store, ciphertext, IV, authentication tag, or KDF salt. It performs
no RPC call and no write, repair, migration, signing, or transaction action.

## Future manual initialization gate

Before separately authorizing `Initialize` mode:

1. confirm a clean Git checkpoint and rerun the complete fixture-only tests;
2. select a new external directory that is not the pilot, smoke, MetaMask, or
   any earlier operator path;
3. decide and document the independent encrypted-backup destination without
   recording user-specific paths in the repository;
4. prepare a strong password stored separately from the encrypted file;
5. run dry-run and stop if the target exists or any safeguard is unexpected;
6. authorize only the one initialization operation;
7. immediately run the local inspector and compare its fingerprint;
8. create and validate an independent encrypted backup before any funding or
   operator work; and
9. stop. Funding and every lifecycle phase remain separate authorizations.

## Lifecycle plan remains unchanged

The future execution sequence remains:

`5 -> 20 -> 50 -> 99 -> manual 100 -> 10 draws -> 10 claims`

This tool implements only preparation for the first artifact in that plan. It
does not implement or authorize any lifecycle write.
