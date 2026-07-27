# Base Sepolia full-lifecycle 99-wallet store tools

Status: store and exact-99 artifact code prepared; real store not initialized

Prepared: 2026-07-19; artifact layer added 2026-07-27

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
or overwrites that pilot. The existing PowerShell `Initialize` mode still
creates only the encrypted store. A separate fixture-tested artifact layer is
now prepared for the manifest, checkpoint, append-only journal, and local
preflight. It has not been run against a real store and is not yet exposed as
an authorized public-network runner.

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

## Exact-99 artifact layer

`scripts/operator/exact-99-operator-artifacts.ts` prepares four roles without
generating wallets or providing any RPC or transaction transport:

- the encrypted store remains the only private wallet-material container;
- the manifest binds purpose, Base Sepolia chain and deployment addresses,
  store ID, exactly 99 ordered public addresses, their order digest, the
  encrypted-file SHA-256 fingerprint, creation time, file identities, and the
  automatic hard stop at 99;
- the checkpoint records the lifecycle stage, cumulative funding/faucet/
  approval/join/draw/claim counts, last confirmed operation, timestamps, and
  explicit pending/ambiguous/manual-review flags;
- the append-only journal records immutable operation events and permits only
  safe forward status transitions. A confirmed or failed terminal event cannot
  move backwards.

The supported checkpoint stages are `initialized`, `inspected`, `funded`,
`checkpoint-5`, `checkpoint-20`, `checkpoint-50`, `checkpoint-99`,
`awaiting-manual-100`, `locked`, `drawing`, `claiming`, `finished`, and
`manual-review`.

The local exact-99 preflight validates the decrypted store inspection against
the three public artifacts. It checks exact count, uniqueness, address order,
store ID and fingerprint, shared set identity, manifest fingerprint, recovery
state, and the 99-join hard stop. Its report is redacted and performs no chain
read. The established five-wallet pilot audit remains unchanged.

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

The prepared code covers the local identity and recovery artifact foundation
for that plan. It does not implement or authorize any lifecycle write.

The fixture-only capped funding subsystem and its artifact/preflight integration
are documented in `docs/RUNBOOK_BASE_SEPOLIA_EXACT_99_FUNDING.md`. The next
fixture-only coordinator is documented in
`docs/RUNBOOK_BASE_SEPOLIA_EXACT_99_ACCUMULATION_COORDINATOR.md`. It fixes the
four ranges, authorizations, per-wallet order, restart rules, and hard stop
after index 98 without creating a public runner. Real initialization, artifact
materialization, backup, live gas-based limit selection, RPC preflight,
funding, and every lifecycle phase still require separate explicit
authorization.

The fixture-only execution runner documented in
`docs/RUNBOOK_BASE_SEPOLIA_EXACT_99_EXECUTION_RUNNER.md` consumes only public
manifest identity and injected fixture results. It does not open the encrypted
store, load a signer, or create a public-network path.

## Store v2 isolation decision

The existing initializer still uses store format v1 and must not be run merely
because a new prototype exists. Format v1 authenticates one envelope but
decrypts all 99 records when a signer selects one wallet.

The fixture-only v2 prototype in
`packages/contracts/scripts/operator/exact-99-wallet-store-v2-fixture.ts`
encrypts each of 99 records separately and can decrypt only the selected index.
It adds per-record salt/IV/tag/ciphertext, order and record digests, whole-set
integrity, public inspection and create-only fixture writing. It rejects
real-key-shaped input and has no generator, signer, provider or migration.

The decision record
`docs/DECISION_EXACT_99_WALLET_STORE_V1_VS_V2.md` recommends a
production-reviewed per-wallet v2 format before the real exact-99 store is
created. The current fixture KDF settings are deliberately not approved for
real secrets. V1-to-v2 migration is not implemented and would require a
separate authorization.
