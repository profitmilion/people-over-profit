import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";

import { computeAddress, getAddress } from "ethers";

import {
  WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX,
  WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  WALLET_STORE_V2_MANIFEST_FILE_NAME,
  WALLET_STORE_V2_STORE_FILE_NAME,
  WalletStoreV2FixtureSecretRecord,
  WalletStoreV2FixtureUnlockSecret,
  assertWalletStoreV2PublicOutput,
  buildGuardedCheckpoint20ManifestFromWalletStoreV2,
  buildWalletStoreV2FixtureBundle,
  createWalletStoreV2FixtureBackup,
  createWalletStoreV2FixtureBundleDirectory,
  inspectWalletStoreV2FixtureBundle,
  readAndInspectWalletStoreV2FixtureBundleDirectory,
  restoreWalletStoreV2FixtureBackup,
  validateWalletStoreV2FixtureBundle,
  validateWalletStoreV2FixtureEnvelope,
  validateWalletStoreV2PublicManifest,
  walletStoreV2BundlePaths,
  walletStoreV2FixtureSecuritySummary,
  withDecryptedWalletStoreV2FixtureRecord,
  type WalletStoreV2Candidate,
  type WalletStoreV2FixtureBundle,
} from "../scripts/operator/guarded-checkpoint-20-wallet-store-v2.js";
import {
  buildEmptyGuardedCheckpoint20Journal,
  serializeGuardedCheckpoint20Journal,
} from "../scripts/operator/guarded-checkpoint-20.js";

const CREATED_AT = "2026-08-08T12:00:00.000Z";
const STORE_ID = "20202020-2020-4020-8020-202020202020";
const FIXTURE_UNLOCK_TEXT = "fixture-only-neutral-canary-unlock-value";
const NEUTRAL_MNEMONIC_CANARY =
  "abandon ability able about above absent absorb abstract absurd abuse access accident";
const roots: string[] = [];

function privateKeyBytes(index: number): Buffer {
  const value = Buffer.alloc(32);
  value.writeUInt32BE(index + 1, 28);
  return value;
}

function candidates(): WalletStoreV2Candidate[] {
  return Array.from({ length: 15 }, (_, index) => ({
    index,
    address: getAddress(computeAddress(`0x${privateKeyBytes(index).toString("hex")}`)),
  }));
}

function unlock(value = FIXTURE_UNLOCK_TEXT): WalletStoreV2FixtureUnlockSecret {
  return WalletStoreV2FixtureUnlockSecret.fromFixtureText(
    value,
    WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  );
}

function fixtureRecord(index: number): WalletStoreV2FixtureSecretRecord {
  const bytes = privateKeyBytes(index);
  try {
    return WalletStoreV2FixtureSecretRecord.fromPrivateKeyBytes({
      index,
      privateKeyBytes: bytes,
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    });
  } finally {
    bytes.fill(0);
  }
}

async function buildBundle(input: {
  publicCandidates?: readonly WalletStoreV2Candidate[];
  recordForIndex?: (index: number) => WalletStoreV2FixtureSecretRecord;
  onProvide?: (index: number) => void;
} = {}): Promise<WalletStoreV2FixtureBundle> {
  return buildWalletStoreV2FixtureBundle({
    candidates: input.publicCandidates ?? candidates(),
    unlockSecret: unlock(),
    createdAt: CREATED_AT,
    storeId: STORE_ID,
    authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    provideRecord: async (index) => {
      input.onProvide?.(index);
      return (input.recordForIndex ?? fixtureRecord)(index);
    },
  });
}

async function temporaryDirectory(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `pop33-wallet-store-v2-${label}-`));
  roots.push(root);
  return join(root, `${label}${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`);
}

describe("Guarded Checkpoint-20 Wallet Store v2", function () {
  this.timeout(120_000);

  afterEach(async function () {
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
  });

  it("builds a fixture-only 15-record store and public ordered manifest", async function () {
    const provided: number[] = [];
    const bundle = await buildBundle({ onProvide: (index) => provided.push(index) });
    const inspection = inspectWalletStoreV2FixtureBundle(bundle);
    assert.deepEqual(provided, Array.from({ length: 15 }, (_, index) => index));
    assert.equal(bundle.envelope.records.length, 15);
    assert.equal(bundle.manifest.candidates.length, 15);
    assert.equal(inspection.recordCount, 15);
    assert.equal(inspection.chainId, "84532");
    assert.equal(inspection.baselineCount, "5");
    assert.equal(inspection.targetCount, "20");
    assert.equal(new Set(bundle.envelope.records.map((record) => record.iv)).size, 15);
    assert.deepEqual(inspection.addresses, candidates().map((candidate) => candidate.address));
  });

  it("binds the store, public manifest, ordering and checkpoint into fingerprints", async function () {
    const bundle = await buildBundle();
    assert.match(bundle.envelope.bindingFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(bundle.envelope.encryptedStoreFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(bundle.manifest.fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(bundle.envelope.manifestFingerprint, bundle.manifest.fingerprint);
    assert.equal(bundle.manifest.store.bindingFingerprint, bundle.envelope.bindingFingerprint);
    assert.equal(
      bundle.manifest.store.encryptedStoreFingerprint,
      bundle.envelope.encryptedStoreFingerprint,
    );
  });

  it("decrypts exactly one selected record, verifies its address and closes the session", async function () {
    const directory = await temporaryDirectory("selected");
    await createWalletStoreV2FixtureBundleDirectory({ directory, bundle: await buildBundle() });
    const decrypted: number[] = [];
    let retainedSession: Parameters<Parameters<typeof withDecryptedWalletStoreV2FixtureRecord>[0]["callback"]>[0] | null = null;
    let observedKey: Buffer | null = null;
    const receipt = await withDecryptedWalletStoreV2FixtureRecord({
      directory,
      index: 5,
      unlockSecret: unlock(),
      onRecordDecrypted: (index) => decrypted.push(index),
      callback: async (session) => {
        retainedSession = session;
        assert.equal(session.index, 5);
        assert.equal(session.address, candidates()[5].address);
        await session.withPrivateKeyBytes((bytes) => {
          observedKey = Buffer.from(bytes);
        });
      },
    });
    try {
      assert.deepEqual(decrypted, [5]);
      assert.deepEqual(observedKey, privateKeyBytes(5));
      assert.equal(receipt.addressVerified, true);
      assert.equal(receipt.sessionClosed, true);
      assert.equal(retainedSession!.closed, true);
      await assert.rejects(
        retainedSession!.withPrivateKeyBytes(() => undefined),
        /closed/,
      );
    } finally {
      if (observedKey !== null) (observedKey as Buffer).fill(0);
    }
  });

  it("prevents secret records, unlock secrets and sessions from serialization or spreading", async function () {
    const secretRecord = fixtureRecord(0);
    const unlockSecret = unlock();
    assert.deepEqual({ ...secretRecord }, {});
    assert.deepEqual({ ...unlockSecret }, {});
    assert.throws(() => JSON.stringify(secretRecord), /cannot be serialized/);
    assert.throws(() => JSON.stringify(unlockSecret), /cannot be serialized/);
    assert.match(inspect(secretRecord), /REDACTED/);
    assert.match(inspect(unlockSecret), /REDACTED/);
    secretRecord.destroy();
    unlockSecret.destroy();
  });

  it("rejects any callback return value so a secret session cannot escape", async function () {
    const directory = await temporaryDirectory("return-rejected");
    await createWalletStoreV2FixtureBundleDirectory({ directory, bundle: await buildBundle() });
    await assert.rejects(
      withDecryptedWalletStoreV2FixtureRecord({
        directory,
        index: 0,
        unlockSecret: unlock(),
        callback: (async (session: unknown) => session) as unknown as () => Promise<void>,
      }),
      /failed without exposing secret material/,
    );
  });

  it("rejects a wrong unlock secret with a generic secret-free error", async function () {
    const directory = await temporaryDirectory("wrong-password");
    await createWalletStoreV2FixtureBundleDirectory({ directory, bundle: await buildBundle() });
    let error: unknown;
    try {
      await withDecryptedWalletStoreV2FixtureRecord({
        directory,
        index: 3,
        unlockSecret: unlock("different-fixture-only-neutral-unlock"),
        callback: () => undefined,
      });
      assert.fail("Wrong unlock secret should fail.");
    } catch (caught) {
      error = caught;
    }
    assert.doesNotMatch(String(error), new RegExp(FIXTURE_UNLOCK_TEXT, "i"));
    assert.match(String(error), /failed without exposing secret material/);
  });

  it("fails creation when derived private-key address does not match the manifest", async function () {
    await assert.rejects(
      buildBundle({ recordForIndex: (index) => fixtureRecord(index === 0 ? 1 : index) }),
      /creation failed without exposing secret material/,
    );
  });

  it("rejects modified ciphertext and authentication material", async function () {
    const bundle = await buildBundle();
    for (const field of ["ciphertext", "authenticationTag"] as const) {
      const changed = structuredClone(bundle);
      changed.envelope.records[4][field] = Buffer.alloc(
        field === "ciphertext" ? 32 : 16,
        0x7f,
      ).toString("base64");
      assert.throws(() => validateWalletStoreV2FixtureBundle(changed), /fingerprint mismatch/);
    }
  });

  it("rejects modified or reordered public manifest candidates", async function () {
    const bundle = await buildBundle();
    const changedAddress = structuredClone(bundle.manifest);
    changedAddress.candidates[0].address = candidates()[1].address;
    assert.throws(() => validateWalletStoreV2PublicManifest(changedAddress), /duplicate|fingerprint|binding/);
    const reordered = structuredClone(bundle.manifest) as typeof bundle.manifest & {
      candidates: WalletStoreV2Candidate[];
    };
    [reordered.candidates[0], reordered.candidates[1]] = [reordered.candidates[1], reordered.candidates[0]];
    assert.throws(() => validateWalletStoreV2PublicManifest(reordered), /order|fingerprint|binding/);
  });

  for (const [name, mutate, expected] of [
    ["chain ID", (value: Record<string, unknown>) => { value.chainId = "1"; }, /chain ID/i],
    ["contract", (value: Record<string, unknown>) => { value.contractAddress = candidates()[0].address; }, /contract/i],
    ["token", (value: Record<string, unknown>) => { value.tokenAddress = candidates()[0].address; }, /token/i],
  ] as const) {
    it(`rejects a modified manifest ${name}`, async function () {
      const manifest = structuredClone((await buildBundle()).manifest) as unknown as Record<string, unknown>;
      mutate(manifest);
      assert.throws(() => validateWalletStoreV2PublicManifest(manifest), expected);
    });
  }

  it("rejects modified checkpoint identity and fingerprints", async function () {
    const bundle = await buildBundle();
    const checkpoint = structuredClone(bundle.manifest);
    checkpoint.checkpoint.targetCount = "99" as "20";
    assert.throws(() => validateWalletStoreV2PublicManifest(checkpoint), /checkpoint/i);
    const manifestFingerprint = structuredClone(bundle.manifest);
    manifestFingerprint.fingerprint = `sha256:${"f".repeat(64)}`;
    assert.throws(() => validateWalletStoreV2PublicManifest(manifestFingerprint), /fingerprint/i);
    const storeFingerprint = structuredClone(bundle.envelope);
    storeFingerprint.encryptedStoreFingerprint = `sha256:${"e".repeat(64)}`;
    assert.throws(() => validateWalletStoreV2FixtureEnvelope({
      value: storeFingerprint,
      manifest: bundle.manifest,
    }), /binding|fingerprint/i);
  });

  it("rejects duplicate addresses and every record count other than 15", async function () {
    const duplicate = candidates();
    duplicate[14] = { index: 14, address: duplicate[0].address };
    await assert.rejects(buildBundle({ publicCandidates: duplicate }), /duplicate/);
    await assert.rejects(buildBundle({ publicCandidates: candidates().slice(0, 14) }), /exactly 15/);
  });

  it("uses a strict public-output allowlist even when a secret has a neutral field name", function () {
    assert.throws(() => assertWalletStoreV2PublicOutput({
      kind: "wallet-store-v2-session-receipt",
      fixtureOnly: true,
      storeId: STORE_ID,
      index: 0,
      address: candidates()[0].address,
      manifestFingerprint: `sha256:${"a".repeat(64)}`,
      addressVerified: true,
      sessionClosed: true,
      note: NEUTRAL_MNEMONIC_CANARY,
    }), /non-public|unsupported/);
    assert.throws(() => assertWalletStoreV2PublicOutput({
      kind: "wallet-store-v2-session-receipt",
      fixtureOnly: true,
      storeId: STORE_ID,
      index: 0,
      address: `0x${privateKeyBytes(0).toString("hex")}`,
      manifestFingerprint: `sha256:${"a".repeat(64)}`,
      addressVerified: true,
      sessionClosed: true,
    }), /receipt is invalid/);
  });

  it("keeps passwords and fixture private keys out of public artifacts and output streams", async function () {
    const bundle = await buildBundle();
    const directory = await temporaryDirectory("leakage");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    let receipt;
    try {
      console.log = (...values: unknown[]) => { stdout.push(values.join(" ")); };
      console.error = (...values: unknown[]) => { stderr.push(values.join(" ")); };
      await createWalletStoreV2FixtureBundleDirectory({ directory, bundle });
      receipt = await withDecryptedWalletStoreV2FixtureRecord({
        directory,
        index: 7,
        unlockSecret: unlock(),
        callback: () => undefined,
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    const runnerManifest = buildGuardedCheckpoint20ManifestFromWalletStoreV2(bundle.manifest);
    const journal = buildEmptyGuardedCheckpoint20Journal(runnerManifest);
    const publicArtifacts = [
      JSON.stringify(bundle.manifest),
      JSON.stringify(inspectWalletStoreV2FixtureBundle(bundle)),
      JSON.stringify(receipt),
      JSON.stringify(runnerManifest),
      serializeGuardedCheckpoint20Journal(journal),
      stdout.join("\n"),
      stderr.join("\n"),
    ].join("\n");
    assert.equal(publicArtifacts.includes(FIXTURE_UNLOCK_TEXT), false);
    assert.equal(publicArtifacts.includes(NEUTRAL_MNEMONIC_CANARY), false);
    for (let index = 0; index < 15; index += 1) {
      assert.equal(publicArtifacts.includes(privateKeyBytes(index).toString("hex")), false);
    }
    const storeSerialized = await readFile(walletStoreV2BundlePaths(directory).storeFile, "utf8");
    assert.equal(storeSerialized.includes(FIXTURE_UNLOCK_TEXT), false);
    for (let index = 0; index < 15; index += 1) {
      assert.equal(storeSerialized.includes(privateKeyBytes(index).toString("hex")), false);
    }
  });

  it("atomically commits the directory and removes an interrupted partial write", async function () {
    const directory = await temporaryDirectory("interrupted");
    const parent = join(directory, "..");
    await assert.rejects(
      createWalletStoreV2FixtureBundleDirectory({
        directory,
        bundle: await buildBundle(),
        hooks: { afterStoreWrite: () => { throw new Error("fixture interruption"); } },
      }),
      /fixture interruption/,
    );
    await assert.rejects(stat(directory), /ENOENT/);
    assert.equal((await readdir(parent)).some((name) => name.endsWith(".tmp")), false);
  });

  it("detects truncated files, corrupt headers and encrypted-record corruption", async function () {
    const bundle = await buildBundle();
    const truncatedDirectory = await temporaryDirectory("truncated");
    await createWalletStoreV2FixtureBundleDirectory({ directory: truncatedDirectory, bundle });
    await writeFile(walletStoreV2BundlePaths(truncatedDirectory).storeFile, "{", "utf8");
    await assert.rejects(
      readAndInspectWalletStoreV2FixtureBundleDirectory(truncatedDirectory),
      /truncated|corrupt|invalid JSON/,
    );

    const headerDirectory = await temporaryDirectory("header");
    await createWalletStoreV2FixtureBundleDirectory({ directory: headerDirectory, bundle });
    const headerPath = walletStoreV2BundlePaths(headerDirectory).storeFile;
    const header = JSON.parse(await readFile(headerPath, "utf8")) as Record<string, unknown>;
    header.formatVersion = 3;
    await writeFile(headerPath, JSON.stringify(header), "utf8");
    await assert.rejects(
      readAndInspectWalletStoreV2FixtureBundleDirectory(headerDirectory),
      /identity|profile/,
    );

    const recordDirectory = await temporaryDirectory("record");
    await createWalletStoreV2FixtureBundleDirectory({ directory: recordDirectory, bundle });
    const recordPath = walletStoreV2BundlePaths(recordDirectory).storeFile;
    const recordStore = JSON.parse(await readFile(recordPath, "utf8")) as WalletStoreV2FixtureBundle["envelope"];
    recordStore.records[9].ciphertext = Buffer.alloc(32, 0x55).toString("base64");
    await writeFile(recordPath, JSON.stringify(recordStore), "utf8");
    await assert.rejects(
      readAndInspectWalletStoreV2FixtureBundleDirectory(recordDirectory),
      /fingerprint/,
    );
  });

  it("creates an encrypted backup, restores it and verifies identical fingerprints", async function () {
    const sourceDirectory = await temporaryDirectory("source");
    const backupDirectory = await temporaryDirectory("backup");
    const restoreDirectory = await temporaryDirectory("restore");
    await createWalletStoreV2FixtureBundleDirectory({ directory: sourceDirectory, bundle: await buildBundle() });
    const backup = await createWalletStoreV2FixtureBackup({ sourceDirectory, backupDirectory });
    const restored = await restoreWalletStoreV2FixtureBackup({ backupDirectory, restoreDirectory });
    assert.equal(backup.backupVerified, true);
    assert.equal(restored.backupVerified, true);
    assert.equal(restored.encryptedStoreFingerprint, backup.encryptedStoreFingerprint);
    assert.equal(restored.manifestFingerprint, backup.manifestFingerprint);
    const sourceStore = await readFile(walletStoreV2BundlePaths(sourceDirectory).storeFile, "utf8");
    const restoredStore = await readFile(walletStoreV2BundlePaths(restoreDirectory).storeFile, "utf8");
    const sourceManifest = await readFile(walletStoreV2BundlePaths(sourceDirectory).manifestFile, "utf8");
    const restoredManifest = await readFile(walletStoreV2BundlePaths(restoreDirectory).manifestFile, "utf8");
    assert.equal(restoredStore, sourceStore);
    assert.equal(restoredManifest, sourceManifest);
  });

  it("produces a runner-compatible store binding without signer or transaction capability", async function () {
    const bundle = await buildBundle();
    const runnerManifest = buildGuardedCheckpoint20ManifestFromWalletStoreV2(bundle.manifest);
    assert.equal(runnerManifest.addresses.length, 15);
    assert.equal(runnerManifest.storeBinding.storeId, STORE_ID);
    assert.equal(runnerManifest.storeBinding.publicFingerprint, bundle.manifest.fingerprint);
    assert.deepEqual(walletStoreV2FixtureSecuritySummary(), {
      fixtureOnly: true,
      realWalletGenerationAvailable: false,
      walletClientAvailable: false,
      signerAvailable: false,
      transactionTransportAvailable: false,
      selectedRecordOnly: true,
    });
  });

  it("contains no wallet client, signer, RPC write, transaction or random-wallet generator", async function () {
    const source = await readFile(
      new URL("../scripts/operator/guarded-checkpoint-20-wallet-store-v2.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /createWalletClient|sendTransaction|sendRawTransaction|writeContract|signTransaction|signMessage|Wallet\.createRandom|new\s+Wallet\s*\(|JsonRpcProvider|privateKeyToAccount|generatePrivateKey|generateMnemonic/);
    assert.doesNotMatch(source, /https?:\/\//);
  });

  it("keeps public manifest separate from encrypted payload fields", async function () {
    const bundle = await buildBundle();
    const serialized = JSON.stringify(bundle.manifest);
    assert.doesNotMatch(serialized, /private|secret|mnemonic|seed|password|passphrase|ciphertext|authenticationTag|\biv\b|\bsalt\b/i);
    assert.deepEqual(
      bundle.manifest.candidates.map((candidate) => candidate.index),
      Array.from({ length: 15 }, (_, index) => index),
    );
    assert.equal(WALLET_STORE_V2_STORE_FILE_NAME.includes(".enc."), true);
    assert.equal(WALLET_STORE_V2_MANIFEST_FILE_NAME.includes("manifest"), true);
  });
});
