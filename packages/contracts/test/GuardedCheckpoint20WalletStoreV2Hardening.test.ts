import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { inspect } from "node:util";

import { computeAddress, getAddress } from "ethers";

import {
  WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX,
  WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  WALLET_STORE_V2_PRODUCTION_CEREMONY_AUTHORIZATION,
  WALLET_STORE_V2_STORE_FILE_NAME,
  InjectedTestPasswordProvider,
  ProductionTtyPasswordProvider,
  WalletStoreV2FixtureSecretRecord,
  WalletStoreV2FixtureUnlockSecret,
  assertWalletStoreV2PublicOutput,
  buildFixtureGuardedCheckpoint20ManifestFromWalletStoreV2,
  buildProductionGuardedCheckpoint20ManifestFromWalletStoreV2,
  buildTrustedWalletStoreIdentity,
  buildWalletStoreV2FixtureBundle,
  buildWalletStoreV2ProductionBundle,
  calculateWalletStoreV2BindingFingerprint,
  cleanupWalletStoreV2OrphanDirectory,
  createWalletStoreV2FixtureBackup,
  createWalletStoreV2FixtureBundleDirectory,
  listWalletStoreV2OrphanDirectories,
  readAndInspectWalletStoreV2FixtureBundleDirectory,
  restoreWalletStoreV2FixtureBackup,
  validateWalletStoreV2FixtureBundle,
  validateWalletStoreV2ProductionBundle,
  validateWalletStoreV2PublicManifest,
  walletStoreV2BundlePaths,
  withDecryptedWalletStoreV2FixtureRecord,
  type WalletStoreV2Candidate,
  type WalletStoreV2FixtureBundle,
} from "../scripts/operator/guarded-checkpoint-20-wallet-store-v2.js";
import {
  WindowsWalletStoreV2ProductionFileSecurity,
  type WindowsAclAdapter,
  type WindowsAclSnapshot,
} from "../scripts/operator/wallet-store-v2-windows-security.js";

const CREATED_AT = "2026-08-08T15:00:00.000Z";
const STORE_ID = "30303030-3030-4030-8030-303030303030";
const FIXTURE_PASSWORD = "fixture-hardening-password-value";
const roots: string[] = [];

function privateKeyBytes(index: number): Buffer {
  const value = Buffer.alloc(32);
  value.writeUInt32BE(index + 101, 28);
  return value;
}

function candidates(): WalletStoreV2Candidate[] {
  return Array.from({ length: 15 }, (_, index) => {
    const bytes = privateKeyBytes(index);
    try {
      return { index, address: getAddress(computeAddress(`0x${bytes.toString("hex")}`)) };
    } finally {
      bytes.fill(0);
    }
  });
}

function fixtureUnlock(): WalletStoreV2FixtureUnlockSecret {
  return WalletStoreV2FixtureUnlockSecret.fromFixtureText(
    FIXTURE_PASSWORD,
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

async function buildBundle(
  storeId = STORE_ID,
  createdAt = CREATED_AT,
): Promise<WalletStoreV2FixtureBundle> {
  return buildWalletStoreV2FixtureBundle({
    candidates: candidates(),
    unlockSecret: fixtureUnlock(),
    provideRecord: async (index) => fixtureRecord(index),
    createdAt,
    storeId,
    authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  });
}

async function temporaryBundle(label: string): Promise<string> {
  const root = join(tmpdir(), `pop33-v2-hardening-${label}-${randomUUID()}`);
  await mkdir(root, { recursive: false });
  roots.push(root);
  return join(root, `${label}${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function recomputePublicFingerprints(bundle: WalletStoreV2FixtureBundle): void {
  for (const record of bundle.envelope.records) {
    const base: Partial<typeof record> = { ...record };
    delete base.recordFingerprint;
    record.recordFingerprint = digest(base);
  }
  bundle.envelope.recordsFingerprint = digest(bundle.envelope.records.map((record) => record.recordFingerprint));
  const envelopeBase: Partial<typeof bundle.envelope> = { ...bundle.envelope };
  delete envelopeBase.encryptedStoreFingerprint;
  delete envelopeBase.manifestFingerprint;
  const storeFingerprint = digest(envelopeBase);
  bundle.envelope.encryptedStoreFingerprint = storeFingerprint;
  bundle.manifest.store.encryptedStoreFingerprint = storeFingerprint;
  const manifestBase: Partial<typeof bundle.manifest> = { ...bundle.manifest };
  delete manifestBase.fingerprint;
  bundle.manifest.fingerprint = digest(manifestBase);
  bundle.envelope.manifestFingerprint = bundle.manifest.fingerprint;
}

class FakeWindowsAclAdapter implements WindowsAclAdapter {
  readonly adapterClass = "windows-acl" as const;
  protected = false;
  protectIsNoop = false;
  failInspect = false;
  insecureAtOrAfter = Number.POSITIVE_INFINITY;
  inspectCount = 0;
  readonly reparsePaths = new Set<string>();

  async currentUserSid(): Promise<string> { return "S-1-5-21-1000"; }

  async protectDirectory(): Promise<void> {
    if (!this.protectIsNoop) this.protected = true;
  }

  async inspect(): Promise<WindowsAclSnapshot> {
    this.inspectCount += 1;
    if (this.failInspect) throw new Error("fixture ACL inspection failure");
    const entries = [
      { sid: "S-1-5-21-1000", type: "Allow" as const, rights: "FullControl" },
      { sid: "S-1-5-18", type: "Allow" as const, rights: "FullControl" },
      { sid: "S-1-5-32-544", type: "Allow" as const, rights: "FullControl" },
    ];
    if (this.inspectCount >= this.insecureAtOrAfter) {
      entries.push({ sid: "S-1-5-21-9999", type: "Allow", rights: "ReadAndExecute" });
    }
    return { inheritanceProtected: this.protected, entries };
  }

  async isReparsePoint(path: string): Promise<boolean> {
    return this.reparsePaths.has(resolve(path));
  }

  async canonicalPath(path: string): Promise<string> { return resolve(path); }
}

describe("Guarded Checkpoint-20 Wallet Store v2 hardening", function () {
  this.timeout(120_000);

  afterEach(async function () {
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
    delete (globalThis as Record<string, unknown>).walletStoreCanary;
  });

  it("binds artifactClass and rejects fixture/production cross-use", async function () {
    const bundle = await buildBundle();
    assert.equal(bundle.manifest.artifactClass, "fixture");
    assert.equal(bundle.envelope.artifactClass, "fixture");
    assert.equal(
      buildFixtureGuardedCheckpoint20ManifestFromWalletStoreV2(bundle.manifest).storeBinding.artifactClass,
      "fixture",
    );
    assert.throws(
      () => buildProductionGuardedCheckpoint20ManifestFromWalletStoreV2(bundle.manifest),
      /fixture artifact is rejected/,
    );
    assert.throws(
      () => validateWalletStoreV2ProductionBundle(bundle as never),
      /Fixture store is rejected/,
    );
    const productionMarked = { ...structuredClone(bundle), artifactClass: "production" as const };
    assert.throws(
      () => validateWalletStoreV2FixtureBundle(productionMarked as never),
      /fixture bundle marker|Production store is rejected/,
    );
    const changed = structuredClone(bundle.manifest);
    changed.artifactClass = "production";
    assert.throws(() => validateWalletStoreV2PublicManifest(changed), /binding|fingerprint/);
  });

  it("changes the binding fingerprint when only artifactClass changes", function () {
    const base = { createdAt: CREATED_AT, storeId: STORE_ID, candidates: candidates() };
    const fixture = calculateWalletStoreV2BindingFingerprint({ ...base, artifactClass: "fixture" });
    const production = calculateWalletStoreV2BindingFingerprint({ ...base, artifactClass: "production" });
    assert.notEqual(fixture, production);
    assert.throws(
      () => calculateWalletStoreV2BindingFingerprint({
        ...base,
        createdAt: "x".repeat(1_000),
        artifactClass: "fixture",
      }),
      /creation time is invalid/,
    );
  });

  it("keeps injected passwords test-only and rejects them from production creation", async function () {
    const providerBytes = Buffer.from("fixture-injected-provider-password", "utf8");
    const provider = new InjectedTestPasswordProvider(providerBytes, WALLET_STORE_V2_FIXTURE_AUTHORIZATION);
    providerBytes.fill(0);
    await provider.withPassword(async (secret) => {
      assert.throws(() => JSON.stringify(secret), /cannot be serialized/);
      assert.match(inspect(secret), /REDACTED/);
    });
    await assert.rejects(
      buildWalletStoreV2ProductionBundle({
        passwordProvider: provider as never,
        walletGenerator: {} as never,
        createdAt: CREATED_AT,
        authorization: WALLET_STORE_V2_PRODUCTION_CEREMONY_AUTHORIZATION,
      }),
      /rejects injected|fixture password providers/,
    );
    provider.destroy();
  });

  it("requires production authorization for TTY and never instantiates the CSPRNG generator", async function () {
    assert.throws(
      () => ProductionTtyPasswordProvider.create(WALLET_STORE_V2_FIXTURE_AUTHORIZATION),
      /ceremony authorization/,
    );
    assert.equal(
      ProductionTtyPasswordProvider.create(WALLET_STORE_V2_PRODUCTION_CEREMONY_AUTHORIZATION).providerClass,
      "production-tty",
    );
    const source = await readFile(
      new URL("../scripts/operator/guarded-checkpoint-20-wallet-store-v2.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /class NodeCSPRNGProductionWalletGenerator/);
    assert.match(source, /Production wallet generation requires ceremony authorization/);
    assert.match(source, /input\.walletGenerator instanceof NodeCSPRNGProductionWalletGenerator/);
  });

  it("uses hidden TTY/CSPRNG boundaries and no argv, password env, mnemonic or Math.random fallback", async function () {
    const source = await readFile(
      new URL("../scripts/operator/guarded-checkpoint-20-wallet-store-v2.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /readHiddenTtyBytes/);
    assert.match(source, /randomBytes\(KEY_LENGTH\)/);
    assert.doesNotMatch(source, /process\.argv|process\.env\.(?:PASSWORD|PASS|SECRET)|Math\.random|generateMnemonic|createRandom/);
  });

  it("restores only against the independently trusted identity", async function () {
    const sourceDirectory = await temporaryBundle("trusted-source");
    const backupDirectory = await temporaryBundle("trusted-backup");
    const restoreDirectory = await temporaryBundle("trusted-restore");
    const bundle = await buildBundle();
    const identity = buildTrustedWalletStoreIdentity(bundle.manifest);
    await createWalletStoreV2FixtureBundleDirectory({ directory: sourceDirectory, bundle });
    await createWalletStoreV2FixtureBackup({ sourceDirectory, backupDirectory });
    const restored = await restoreWalletStoreV2FixtureBackup({
      backupDirectory,
      restoreDirectory,
      expectedIdentity: identity,
    });
    assert.equal(restored.manifestFingerprint, identity.manifestFingerprint);
  });

  it("rejects substituted, stale, wrong-store and rollback backup identities", async function () {
    const expectedBundle = await buildBundle(STORE_ID);
    const expectedIdentity = buildTrustedWalletStoreIdentity(expectedBundle.manifest);
    for (const [label, backupBundle] of [
      ["substituted", await buildBundle("40404040-4040-4040-8040-404040404040")],
      ["stale", await buildBundle(STORE_ID, "2026-08-07T15:00:00.000Z")],
      ["rollback", await buildBundle(STORE_ID)],
    ] as const) {
      const sourceDirectory = await temporaryBundle(`${label}-source`);
      const backupDirectory = await temporaryBundle(`${label}-backup`);
      const restoreDirectory = await temporaryBundle(`${label}-restore`);
      await createWalletStoreV2FixtureBundleDirectory({ directory: sourceDirectory, bundle: backupBundle });
      await createWalletStoreV2FixtureBackup({ sourceDirectory, backupDirectory });
      await assert.rejects(
        restoreWalletStoreV2FixtureBackup({ backupDirectory, restoreDirectory, expectedIdentity }),
        /trusted identity/,
      );
    }
    const sourceDirectory = await temporaryBundle("wrong-manifest-source");
    const backupDirectory = await temporaryBundle("wrong-manifest-backup");
    const restoreDirectory = await temporaryBundle("wrong-manifest-restore");
    await createWalletStoreV2FixtureBundleDirectory({ directory: sourceDirectory, bundle: expectedBundle });
    await createWalletStoreV2FixtureBackup({ sourceDirectory, backupDirectory });
    const wrongManifestIdentity = structuredClone(expectedIdentity);
    wrongManifestIdentity.manifestFingerprint = `sha256:${"f".repeat(64)}`;
    const identityBase: Partial<typeof wrongManifestIdentity> = { ...wrongManifestIdentity };
    delete identityBase.fingerprint;
    wrongManifestIdentity.fingerprint = digest(identityBase);
    await assert.rejects(
      restoreWalletStoreV2FixtureBackup({
        backupDirectory,
        restoreDirectory,
        expectedIdentity: wrongManifestIdentity,
      }),
      /trusted identity/,
    );
  });

  it("rejects restore overwrite of an existing active bundle", async function () {
    const bundle = await buildBundle();
    const sourceDirectory = await temporaryBundle("overwrite-source");
    const backupDirectory = await temporaryBundle("overwrite-backup");
    const activeDirectory = await temporaryBundle("overwrite-active");
    await createWalletStoreV2FixtureBundleDirectory({ directory: sourceDirectory, bundle });
    await createWalletStoreV2FixtureBackup({ sourceDirectory, backupDirectory });
    await createWalletStoreV2FixtureBundleDirectory({ directory: activeDirectory, bundle });
    await assert.rejects(
      restoreWalletStoreV2FixtureBackup({
        backupDirectory,
        restoreDirectory: activeDirectory,
        expectedIdentity: buildTrustedWalletStoreIdentity(bundle.manifest),
      }),
      /already exists|overwrite is forbidden/,
    );
  });

  it("rejects oversized store input before JSON parsing", async function () {
    const directory = await temporaryBundle("oversized-store");
    await createWalletStoreV2FixtureBundleDirectory({ directory, bundle: await buildBundle() });
    await writeFile(walletStoreV2BundlePaths(directory).storeFile, "x".repeat(64 * 1024 + 1), "utf8");
    await assert.rejects(readAndInspectWalletStoreV2FixtureBundleDirectory(directory), /size limit/);
  });

  it("rejects oversized manifest and backup metadata before JSON parsing", async function () {
    const sourceDirectory = await temporaryBundle("oversized-public-source");
    const bundle = await buildBundle();
    await createWalletStoreV2FixtureBundleDirectory({ directory: sourceDirectory, bundle });
    const sourcePaths = walletStoreV2BundlePaths(sourceDirectory);
    await writeFile(sourcePaths.manifestFile, "x".repeat(32 * 1024 + 1), "utf8");
    await assert.rejects(readAndInspectWalletStoreV2FixtureBundleDirectory(sourceDirectory), /size limit/);

    const cleanSourceDirectory = await temporaryBundle("oversized-metadata-source");
    const backupDirectory = await temporaryBundle("oversized-metadata-backup");
    const restoreDirectory = await temporaryBundle("oversized-metadata-restore");
    await createWalletStoreV2FixtureBundleDirectory({ directory: cleanSourceDirectory, bundle });
    await createWalletStoreV2FixtureBackup({ sourceDirectory: cleanSourceDirectory, backupDirectory });
    await writeFile(
      walletStoreV2BundlePaths(backupDirectory).backupMetadataFile,
      "x".repeat(16 * 1024 + 1),
      "utf8",
    );
    await assert.rejects(
      restoreWalletStoreV2FixtureBackup({
        backupDirectory,
        restoreDirectory,
        expectedIdentity: buildTrustedWalletStoreIdentity(bundle.manifest),
      }),
      /metadata.*size limit|missing or corrupt/,
    );
  });

  it("rejects malformed encoded lengths, wrong KDF parameters and sixteen records", async function () {
    const bundle = await buildBundle();
    const malformed = structuredClone(bundle);
    malformed.envelope.records[0].iv += "AAAA";
    assert.throws(() => validateWalletStoreV2FixtureBundle(malformed), /encoded length/);
    const kdf = structuredClone(bundle);
    kdf.envelope.kdfParameters.n = 1024;
    assert.throws(() => validateWalletStoreV2FixtureBundle(kdf), /KDF parameters/);
    const sixteen = structuredClone(bundle);
    (sixteen.envelope.records as typeof sixteen.envelope.records[number][]).push(
      structuredClone(sixteen.envelope.records[14]),
    );
    assert.throws(() => validateWalletStoreV2FixtureBundle(sixteen), /exactly 15/);
  });

  it("rejects a duplicate IV even when public fingerprints are recomputed", async function () {
    const bundle = structuredClone(await buildBundle());
    bundle.envelope.records[1].iv = bundle.envelope.records[0].iv;
    recomputePublicFingerprints(bundle);
    assert.throws(() => validateWalletStoreV2FixtureBundle(bundle), /IVs must be unique/);
  });

  it("fails GCM authentication after ciphertext tamper with recomputed public fingerprints", async function () {
    const bundle = structuredClone(await buildBundle());
    bundle.envelope.records[7].ciphertext = Buffer.alloc(32, 0xa5).toString("base64");
    recomputePublicFingerprints(bundle);
    assert.doesNotThrow(() => validateWalletStoreV2FixtureBundle(bundle));
    const directory = await temporaryBundle("gcm-tamper");
    await createWalletStoreV2FixtureBundleDirectory({ directory, bundle });
    await assert.rejects(
      withDecryptedWalletStoreV2FixtureRecord({
        directory,
        index: 7,
        unlockSecret: fixtureUnlock(),
        callback: () => undefined,
      }),
      /failed without exposing secret material/,
    );
  });

  it("documents arbitrary fixture callback exfiltration while production exposes no callback", async function () {
    const directory = await temporaryBundle("callback-boundary");
    const leakedFile = join(dirname(directory), "fixture-leak-proof.txt");
    await createWalletStoreV2FixtureBundleDirectory({ directory, bundle: await buildBundle() });
    const consoleOutput: string[] = [];
    const originalLog = console.log;
    try {
      console.log = (...values: unknown[]) => { consoleOutput.push(values.join(" ")); };
      await withDecryptedWalletStoreV2FixtureRecord({
        directory,
        index: 2,
        unlockSecret: fixtureUnlock(),
        callback: async (session) => {
          await session.withPrivateKeyBytes(async (bytes) => {
            const copy = Buffer.from(bytes);
            try {
              (globalThis as Record<string, unknown>).walletStoreCanary = Buffer.from(copy);
              await writeFile(leakedFile, copy);
              console.log(copy.toString("hex"));
            } finally {
              copy.fill(0);
            }
          });
        },
      });
      assert.equal((await stat(leakedFile)).size, 32);
      assert.equal(consoleOutput.length, 1);
      assert.ok(Buffer.isBuffer((globalThis as Record<string, unknown>).walletStoreCanary));
    } finally {
      console.log = originalLog;
      const globalCopy = (globalThis as Record<string, unknown>).walletStoreCanary;
      if (Buffer.isBuffer(globalCopy)) globalCopy.fill(0);
      await rm(leakedFile, { force: true });
    }
    const source = await readFile(
      new URL("../scripts/operator/guarded-checkpoint-20-wallet-store-v2.ts", import.meta.url),
      "utf8",
    );
    const productionVerifier = source.slice(source.indexOf("verifyDecryptedWalletStoreV2ProductionRecord"));
    assert.doesNotMatch(productionVerifier.split("function buildGuardedCheckpoint20ManifestForArtifactClass")[0], /callback\s*:/);
  });

  it("sanitizes thrown error, cause and stack and rejects nested neutral output", async function () {
    const directory = await temporaryBundle("error-sanitize");
    await createWalletStoreV2FixtureBundleDirectory({ directory, bundle: await buildBundle() });
    let caught: unknown;
    try {
      await withDecryptedWalletStoreV2FixtureRecord({
        directory,
        index: 3,
        unlockSecret: fixtureUnlock(),
        callback: async (session) => {
          await session.withPrivateKeyBytes((bytes) => {
            throw new Error(`fixture failure ${Buffer.from(bytes).toString("hex")}`, {
              cause: { value: Buffer.from(bytes).toString("hex") },
            });
          });
        },
      });
    } catch (error) {
      caught = error;
    }
    const serialized = `${String(caught)}\n${caught instanceof Error ? caught.stack : ""}\n${
      caught instanceof Error ? String(caught.cause) : ""
    }`;
    assert.equal(serialized.includes(privateKeyBytes(3).toString("hex")), false);
    assert.throws(() => assertWalletStoreV2PublicOutput({
      kind: "wallet-store-v2-session-receipt",
      artifactClass: "fixture",
      storeId: STORE_ID,
      index: 0,
      address: candidates()[0].address,
      manifestFingerprint: `sha256:${"a".repeat(64)}`,
      addressVerified: true,
      sessionClosed: true,
      data: { payload: { value: "neutral-secret-canary" } },
    }), /non-public|unsupported/);
  });

  it("rejects inherited insecure ACL and ACL verification failure", async function () {
    for (const mode of ["inherited", "failure"] as const) {
      const localRoot = join(tmpdir(), `pop33-acl-${mode}-${randomUUID()}`);
      await mkdir(localRoot, { recursive: false });
      roots.push(localRoot);
      const root = join(localRoot, "POP33", "operator", "checkpoint-20");
      const adapter = new FakeWindowsAclAdapter();
      if (mode === "inherited") adapter.protectIsNoop = true;
      else adapter.failInspect = true;
      const security = new WindowsWalletStoreV2ProductionFileSecurity({
        rootDirectory: root,
        localAppDataDirectory: localRoot,
        workspaceDirectory: resolve(localRoot, "unrelated-workspace"),
        adapter,
      });
      await assert.rejects(
        security.assertBeforeCreate(join(root, `store${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`)),
        /inheritance|inspection failure/,
      );
    }
  });

  it("accepts secure ACL and performs a fail-closed post-commit ACL recheck", async function () {
    const localRoot = join(tmpdir(), `pop33-acl-secure-${randomUUID()}`);
    await mkdir(localRoot, { recursive: false });
    roots.push(localRoot);
    const root = join(localRoot, "POP33", "operator", "checkpoint-20");
    const adapter = new FakeWindowsAclAdapter();
    const security = new WindowsWalletStoreV2ProductionFileSecurity({
      rootDirectory: root,
      localAppDataDirectory: localRoot,
      workspaceDirectory: resolve(localRoot, "unrelated-workspace"),
      adapter,
    });
    const bundleDirectory = join(root, `store${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`);
    await security.assertBeforeCreate(bundleDirectory);
    adapter.insecureAtOrAfter = adapter.inspectCount + 1;
    await assert.rejects(security.assertAfterCommit(bundleDirectory), /unsupported principal/);
  });

  it("rejects relative, repository, synchronized and reparse-point production paths", async function () {
    const adapter = new FakeWindowsAclAdapter();
    assert.throws(() => new WindowsWalletStoreV2ProductionFileSecurity({
      rootDirectory: "relative-root",
      localAppDataDirectory: resolve(tmpdir()),
      adapter,
    }), /must be absolute/);
    const workspace = resolve("D:/piotr/Documents/pop33-ui-codex");
    assert.throws(() => new WindowsWalletStoreV2ProductionFileSecurity({
      rootDirectory: join(workspace, "secret-root"),
      localAppDataDirectory: dirname(workspace),
      workspaceDirectory: workspace,
      adapter,
    }), /outside the workspace/);
    const localRoot = join(tmpdir(), `pop33-path-${randomUUID()}`);
    await mkdir(localRoot, { recursive: false });
    roots.push(localRoot);
    const syncRoot = join(localRoot, "OneDrive");
    assert.throws(() => new WindowsWalletStoreV2ProductionFileSecurity({
      rootDirectory: join(syncRoot, "POP33"),
      localAppDataDirectory: localRoot,
      synchronizedDirectories: [syncRoot],
      workspaceDirectory: resolve(localRoot, "unrelated-workspace"),
      adapter,
    }), /must not be inside OneDrive/);
    adapter.reparsePaths.add(resolve(localRoot));
    const security = new WindowsWalletStoreV2ProductionFileSecurity({
      rootDirectory: join(localRoot, "POP33"),
      localAppDataDirectory: localRoot,
      workspaceDirectory: resolve(localRoot, "unrelated-workspace"),
      adapter,
    });
    await assert.rejects(
      security.assertBeforeCreate(join(localRoot, "POP33", `store${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`)),
      /reparse point/,
    );
  });

  it("lists and removes only an explicitly recognized orphan temp directory", async function () {
    const target = await temporaryBundle("orphan-target");
    const parent = dirname(target);
    const orphan = join(parent, `.${basename(target)}.${randomUUID()}.tmp`);
    await mkdir(orphan);
    await writeFile(join(orphan, WALLET_STORE_V2_STORE_FILE_NAME), "encrypted fixture orphan", "utf8");
    assert.deepEqual(await listWalletStoreV2OrphanDirectories(target), [orphan]);
    await cleanupWalletStoreV2OrphanDirectory({ targetDirectory: target, orphanDirectory: orphan });
    await assert.rejects(stat(orphan), /ENOENT/);
    await assert.rejects(
      cleanupWalletStoreV2OrphanDirectory({ targetDirectory: target, orphanDirectory: parent }),
      /not recognized/,
    );
  });
});
