# POP33 Wallet Store v2

Status: ceremony-hardened fixture and production boundaries prepared for a
third independent read-only review. The production entrypoint has no CLI or
package script and remains operationally disabled. No production ceremony has
been run. No real checkpoint-20 wallet,
password, store, manifest, trusted identity, or backup exists.

## Scope and three separate stages

Wallet Store v2 is the future private persistence boundary for the 15
checkpoint-20 candidates. The encrypted store contains one independently
authenticated private-key record per candidate. Its separate public manifest
contains only candidate indices, public addresses, deployment/checkpoint
identity, artifact class, and fingerprints.

The stages below are independent authorization boundaries. Completing one does
not authorize the next.

### Fixture

Fixture mode exists only for local automated tests. It requires the literal
`POP33_WALLET_STORE_V2_TEST_FIXTURE_ONLY`, accepts deterministic test records,
uses temporary external directories, and exposes the deliberately fixture-only
callback harness used by leakage tests.

Every fixture envelope, public manifest, binding, runner store binding, backup
metadata, inspection, and receipt carries `artifactClass: "fixture"`. The
production validators and production runner binding reject it. Changing only
the artifact class changes the binding fingerprint and invalidates the bundle;
there is no fixture-to-production conversion.

### Production ceremony

Production ceremony means creating 15 new, independent, unfunded Base Sepolia
wallets and their encrypted store. The code boundary is prepared, but the
ceremony is not authorized and has not been executed.

The prepared production path requires all of the following together:

1. the production ceremony authorization gate;
2. Node.js cryptographic `randomBytes(32)` for every independent private key,
   with no mnemonic, deterministic seed, shared seed, or `Math.random()`
   fallback;
3. a hidden raw-TTY password prompt with confirmation; production APIs reject
   injected/fixture password providers;
4. a production bundle carrying `artifactClass: "production"` through every
   identity and fingerprint;
5. an exact canonical Windows checkpoint root or one of its allowlisted
   `active`, `backup`, or `identity` children, outside the repository,
   worktrees, OneDrive, and known synchronized directories;
6. no symlink, junction, or other reparse point in the path;
7. create-only persistence with ACL inheritance disabled and access restricted
   to the current user, SYSTEM, and local Administrators;
8. fail-closed ACL and canonical-path verification before creation, after the
   atomic commit, and before every production open;
9. a separately retained `TrustedWalletStoreIdentity` checked before backup,
   restore, or selected-record verification.

The intended root is:

`%LOCALAPPDATA%\POP33\operator\checkpoint-20`

The only allowlisted children are:

- `%LOCALAPPDATA%\POP33\operator\checkpoint-20\active`;
- `%LOCALAPPDATA%\POP33\operator\checkpoint-20\backup`;
- `%LOCALAPPDATA%\POP33\operator\checkpoint-20\identity`.

The policy rejects `%LOCALAPPDATA%`, `%LOCALAPPDATA%\POP33`, the `operator`
parent, arbitrary descendants, and similar-prefix paths before any ACL is
changed. Active and backup bundle names are fixed below their respective
children. The independently trusted identity and public ceremony state have
fixed filenames below `identity`.

Do not put the production root or backup in the repository, a worktree,
OneDrive, Dropbox, Google Drive, a shared folder, or another synchronization
root. Do not create the real root until a separately approved ceremony names
the exact active-store path, backup path, trusted-identity custody, and human
verification steps.

## Production ceremony orchestrator and durable state

One narrow library orchestrator now owns the complete production ordering:

environment/authentication precheck -> exact active/backup/identity path and
ACL validation -> hidden password and confirmation -> exactly 15 independent
keys -> encrypted store and public manifest -> independently persisted
`TrustedWalletStoreIdentity` -> encrypted backup -> backup verification against
that external identity -> final active/backup/identity reread -> `complete`.

There is deliberately no `npm run ceremony`, launcher, or enabled CLI. Calling
the library entrypoint for real remains prohibited until a later independent
review returns GO and Piotr separately authorizes the ceremony.

The durable public-only state machine is:

`prepared -> paths-verified -> keys-generating -> keys-generated ->
store-written -> identity-written -> backup-written -> backup-verified ->
final-verified -> complete`

The state contains paths, timestamps, revision, stage, public trusted identity,
and fingerprints only. It never contains a password, private key, plaintext
record, derived key, or decrypted material. Final public success contains only
the store ID, three public fingerprints, 15 public addresses, and fixed active,
backup, identity, and state paths.

The active bundle atomically includes a public ceremony metadata record. It
binds the store ID to the fixed external trusted-identity/state paths and the
trusted-identity fingerprint. The backup intentionally does not become the
source of expected identity; restore still requires the independently retained
identity file.

Crash policy is intentionally conservative:

- `prepared` or `paths-verified`, with no material or orphan artifacts, may be
  revalidated and retried;
- `keys-generating` or any later incomplete stage blocks regeneration and
  requires an explicit operator recovery procedure;
- active-without-manifest, store/manifest-without-identity,
  identity-without-backup, unverified backup, unknown/orphan temp content, and
  mismatched state/artifacts all fail closed;
- a complete existing ceremony is reverified against the independent identity
  and blocks generation of a second wallet set;
- no partial artifact is overwritten or deleted automatically.

Do not manually delete an incomplete state, bundle, identity, backup, lock, or
orphan directory. Preserve it for incident analysis and follow a separately
reviewed recovery/cleanup procedure. Blind resume is forbidden.

The password is accepted only from the hidden interactive TTY provider. It is
not accepted through command arguments, environment variables, `.env`, a
PowerShell literal/history entry, a file, journal, stdout, or stderr. The
current implementation uses mutable buffers where possible and clears them in
`finally`. JavaScript/V8 does not guarantee complete zeroization; the short
immutable hex string required by ethers address derivation is explicitly
limited in lifetime and is never retained or logged.

### Execute

Execute is a separate, later milestone. Wallet Store v2 currently has no
wallet client, signer, transaction sender, or RPC-write transport. Its minimal
production verification flow stops after:

production store -> trusted identity check -> ACL/path check -> hidden unlock
-> decrypt one record -> derive address -> compare manifest -> public receipt
-> cleanup

There is no arbitrary callback in the production verification API. A future
internal trusted action must be separately designed, reviewed, and connected
only after the runner execute blockers listed below are resolved.

## Cryptographic and identity format

- format version: `2`;
- KDF: Node.js `scrypt`, `N=65536`, `r=8`, `p=1`, random 16-byte store salt;
- cipher: AES-256-GCM;
- every record has a unique random 12-byte IV and 16-byte authentication tag;
- plaintext is exactly one selected 32-byte key, never a JSON wallet set;
- authenticated data binds artifact class, store ID, ordered address, index,
  Base Sepolia `84532`, POP33, dUSDC, and checkpoint `5 -> 20`;
- record, ordered-set, encrypted-store, binding, manifest, backup-metadata, and
  trusted-identity fingerprints detect corruption and substitution.

Parsing is bounded before JSON/KDF/decryption: store, manifest, and backup
metadata have independent file limits; the record count is exactly 15; encoded
salt/IV/tag/ciphertext lengths and critical header strings are fixed. Duplicate
IVs, altered KDF parameters, extra fields, oversized inputs, and malformed
lengths fail closed.

## Trusted identity and backup

`TrustedWalletStoreIdentity` is public but must come from a trusted source
outside the backup being restored. It binds version, artifact class, store ID,
chain, contract, token, checkpoint, record count, store binding, encrypted
store fingerprint, manifest fingerprint, and its own fingerprint.

A backup cannot declare its own expected identity. Restore requires the
operator to supply the independently retained identity and rejects substituted,
stale, wrong-store, wrong-manifest, rollback, and overwrite cases. Store,
manifest, and public backup metadata remain encrypted/public artifacts only;
there is no plaintext backup. The password must never be stored beside them.

Writes use a new temporary directory followed by a same-volume atomic rename.
An existing active bundle is never replaced. Orphan cleanup is a separate,
explicit operation: it recognizes only the exact Wallet Store v2 temp naming
pattern and known encrypted/public files and refuses unknown entries.

## Fixture callback warning

The fixture session intentionally proves that an arbitrary callback can copy
secret bytes through globals, file writes, console output, or thrown values.
Regex redaction cannot make a malicious callback safe. The fixture harness
therefore must never become a public production API. Production exposes only
the internal address-verification operation and an allowlisted public receipt.

Errors crossing the fixture boundary are replaced with generic secret-free
errors; `cause`, stack, nested objects, neutral field names, and non-allowlisted
output fields are rejected or discarded.

## Never publish or paste

Piotr must never paste, upload, commit, screenshot, or send:

- a private key, mnemonic, seed, password, or unlock material;
- a decrypted record, production secret object, or session object;
- the real encrypted store or backup unless the destination was explicitly
  approved for encrypted custody;
- terminal output that may contain secret material;
- credential-bearing RPC URLs, wallet configuration, or signer material.

Only the reviewed public manifest, `TrustedWalletStoreIdentity`, and allowlisted
public receipts are candidates for normal operator reporting, subject to the
approved custody procedure.

## Still mandatory before execute

Wallet Store v2 does not fix or authorize the runner execute path. The
following controls remain separate blockers:

1. exact `poolCount === baseline + completedCandidates` enforcement;
2. transaction journal v2 from prepared through final;
3. semantic receipt reconciliation;
4. dual-RPC confirmation depth and canonical-block verification;
5. a real global transaction run lock;
6. mandatory non-null phase evidence;
7. critical readiness risks promoted to execute blockers;
8. aggregate fee and funding-budget enforcement.

After this ceremony-hardening commit, the next step is a third independent
read-only security review. It is not a production ceremony and not
authorization for a Base Sepolia transaction.
