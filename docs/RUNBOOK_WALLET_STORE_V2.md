# POP33 Wallet Store v2

Status: fixture/local implementation prepared for review. No real checkpoint-20
wallet store or wallet exists.

## What this is

The encrypted wallet store is the future private file that will hold the
minimum key material for the 15 checkpoint-20 candidates. The public manifest
is a separate file containing only candidate indices, public addresses,
deployment identity, checkpoint identity, and fingerprints.

Private keys never belong in the repository. The future real bundle is planned
for an external directory such as `%LOCALAPPDATA%\POP33\operator\...`; this
milestone creates and tests bundles only below temporary fixture directories.
The repository ignores Wallet Store v2 store, manifest, backup, and bundle
names as an additional defense against accidental staging.

## What was reused and what changed from v1

Reused:

- Node.js `scrypt` and AES-256-GCM rather than custom cryptography;
- the existing external-path and atomic private-file helpers;
- strict object validation, normalized EVM addresses, canonical fingerprints,
  and checkpoint-20 manifest binding.

Changed:

- v1 decrypts a single ciphertext containing every wallet and builds all
  `Wallet` objects in memory;
- v2 encrypts every record independently and decrypts only the selected index;
- v2 has no `Wallet`, provider, signer, RPC, signature, or transaction API;
- fixture creation is protected by the literal
  `POP33_WALLET_STORE_V2_TEST_FIXTURE_ONLY`; there is no real-wallet generator.

## Cryptographic format

- version: `2`;
- KDF: Node.js `scrypt`, `N=65536`, `r=8`, `p=1`, random 16-byte store salt;
- cipher: AES-256-GCM;
- every record has a unique random 12-byte IV and a 16-byte authentication tag;
- plaintext is only the selected 32-byte fixture key, never a JSON object;
- authenticated additional data binds version, store ID, ordered public
  address, index, Base Sepolia `84532`, POP33, dUSDC, and checkpoint `5 -> 20`;
- record, ordered-set, encrypted-store, binding, and public-manifest
  fingerprints detect corruption or substitution before use.

The unlock secret is passed as a non-serializable, one-use object. There is no
CLI password parameter or environment password. A future password reader must
use a hidden interactive/OS-backed mechanism and clear its temporary memory.

## One-record session

The fixture API follows this sequence:

1. validate the encrypted bundle and public manifest;
2. validate candidate index `0..14`;
3. derive the store key once;
4. decrypt exactly the selected ciphertext;
5. derive its public address and compare it with both the record and manifest;
6. invoke one isolated callback;
7. reject every callback return value;
8. zero the plaintext/key buffers and close the session;
9. return only an allowlisted public receipt.

Secret record, unlock-secret, and decrypted-session objects have private
fields, no enumerable secret properties, throwing JSON/text conversion, and
redacted `inspect` output. JavaScript cannot stop a malicious trusted callback
from copying bytes deliberately, so a later signer adapter must remain a small,
reviewed callback that never exposes or logs its input.

## Public output and manifest

Public output is a strict allowlist, not arbitrary objects plus regex
redaction. Every allowed field is validated by type and format. A neutral field
such as `note` is rejected even if its name does not look secret-bearing.

The public manifest contains:

- candidate indices `0..14` and ordered public addresses;
- chain, POP33, dUSDC, baseline `5`, target `20`, and record count `15`;
- store ID, format version, binding fingerprint, encrypted-store fingerprint,
  and manifest fingerprint.

It never contains a private key, mnemonic, seed, unlock secret, salt, IV,
authentication tag, ciphertext, or decrypted payload. Reordering candidates
changes the binding and manifest fingerprints and fails closed.

## Atomic bundle and backup

Store and manifest are written into a new private temporary directory, checked,
and committed together by a same-volume directory rename. Existing bundle
directories are never overwritten. Interrupted writes remove the temporary
directory and leave no final partial bundle.

A fixture backup copies only the encrypted store and public manifest, adds
public fingerprint metadata, then rereads and verifies the backup. Restore is
create-only and must reproduce both encrypted-store and manifest fingerprints.
No plaintext backup exists.

Backups are useful only if both encrypted store and public manifest are
recoverable and their fingerprints still match. The password must never be
stored beside either copy.

## Never share

Never paste or upload any of the following to ChatGPT, GitHub, an issue, a
runbook, screenshots, or logs:

- private key, mnemonic, seed phrase, password, or unlock material;
- decrypted record or session object;
- real encrypted store if its handling policy has not explicitly approved the
  destination;
- terminal output that may contain a secret.

Only the reviewed public manifest and public fingerprint receipts are intended
for normal operator reports.

## Still mandatory before real wallets or execute

This milestone does not authorize real wallet generation. Before creating the
15 real records, a separate review must approve the real secret-input source,
hidden password flow, external directory, backup location, recovery procedure,
permissions, and trusted selected-record callback.

Before any execute-path, all security-review requirements remain mandatory:

1. exact `poolCount === baseline + completedCandidates`;
2. transaction journal v2 from prepared through final;
3. semantic receipt reconciliation;
4. dual-RPC confirmation depth and canonical block verification;
5. a real global run lock;
6. mandatory non-null phase evidence;
7. critical readiness risks promoted to execute blockers;
8. aggregate fee and funding budget enforcement.

No item above is implemented or authorized by Wallet Store v2.
