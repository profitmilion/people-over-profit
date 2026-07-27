# Decision: exact-99 wallet store v1 envelope versus v2 per-wallet records

Last reviewed: 2026-07-27

Status: fixture-only technical recommendation; no real store migration or
creation is authorized.

## Decision

Use a reviewed production-strength version of **variant B, store v2 with one
encrypted record per participant wallet**, before creating the real exact-99
store.

Do not create the real store from the current fixture prototype. First replace
its deliberately low-cost fixture KDF profile with an approved runtime profile,
complete an independent security review, and add a separately authorized
creation/backup ceremony.

## Variant A: one encrypted envelope with 99 keys

The existing v1 design has useful strengths:

- it is already integrated and tested;
- one authenticated envelope protects ordering and the complete set;
- the create-only initializer and inspector are mature;
- a separate isolated signer process could reduce how long plaintext remains
  reachable by the operator.

Its main weakness is decryption scope. Selecting one wallet currently decrypts
the complete plaintext envelope. A bug, memory disclosure or compromised
signer session can therefore expose all 99 participant records at once.
Process isolation reduces exposure to the parent process but does not change
the size of the secret loaded into the signer process.

## Variant B: separately encrypted wallet records

The fixture v2 prototype has:

- a versioned fixture-only format and shared store ID;
- exactly 99 ordered public address records;
- a separate salt, IV, authentication tag and ciphertext per record;
- a record digest, order digest, records digest and whole-set integrity digest;
- an explicit comparison of store ID, order digest and integrity digest with
  the expected external manifest binding;
- read-only inspection of public metadata without decrypting records;
- selection and decryption of only index `0..98`;
- create-only, no-overwrite fixture file writing;
- explicit rejection of inputs shaped like real private keys;
- no generator, signer, provider, environment read, RPC or migration command.

This reduces the secret exposed per operation from 99 wallets to one. It also
makes per-wallet signer sessions and zeroization boundaries easier to audit.
Tampering with, removing, reordering or substituting a record is detected
before selected-record decryption.

The trade-offs are higher format and lifecycle complexity, 99 KDF operations
at creation, more metadata, and a new implementation that needs independent
cryptographic and operational review. Whole-set integrity metadata must be
updated only during an explicitly authorized create/migration ceremony.

## Migration boundary

Migration from v1 is intentionally not implemented. It would necessarily
decrypt the existing full envelope and create a new secret-bearing artifact.
That operation needs:

1. a separate prompt and exact authorization;
2. an offline or tightly controlled host;
3. approved production KDF parameters;
4. validated create-only destination and encrypted backup;
5. source/destination fingerprint evidence;
6. post-migration inspection;
7. secure handling and retirement decision for the old artifact.

No automatic migration, overwrite or in-place conversion is acceptable.

## Why v2 is recommended

The exact-99 lifecycle performs many operations while normally needing only
one participant key at a time. Per-wallet encryption therefore matches the
execution unit and limits the blast radius of an operator or signer failure.
Store v1 plus process isolation remains a defensible fallback if v2 cannot be
reviewed in time, but it leaves all 99 secrets inside each decryption session.

The recommendation does not itself authorize real wallet generation or store
creation.
