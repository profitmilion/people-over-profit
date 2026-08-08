import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX,
  WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME,
  WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  WALLET_STORE_V2_STORE_FILE_NAME,
  WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME,
  InjectedTestPasswordProvider,
  NodeCSPRNGProductionWalletGenerator,
  buildTrustedWalletStoreIdentity,
  buildWalletStoreV2ProductionFormatFixtureBundle,
  createWalletStoreV2ProductionBackup,
  createWalletStoreV2ProductionBundleDirectory,
  readConfirmedWalletStoreV2PasswordForFixture,
  readHiddenWalletStoreV2PasswordForFixture,
  restoreWalletStoreV2ProductionBackup,
  verifyDecryptedWalletStoreV2ProductionFormatFixtureRecord,
  type WalletStoreV2CeremonyFileSecurity,
  type WalletStoreV2ProductionBundle,
  type WalletStoreV2SignalSource,
  type WalletStoreV2TtyInput,
  type WalletStoreV2TtyOutput,
} from "../scripts/operator/guarded-checkpoint-20-wallet-store-v2.js";
import {
  runWalletStoreV2ProductionFormatFixtureCeremony,
  walletStoreV2CeremonyPaths,
  type WalletStoreV2CeremonyDependencies,
  type WalletStoreV2CeremonyFaultBoundary,
} from "../scripts/operator/wallet-store-v2-ceremony.js";
import {
  WindowsWalletStoreV2ProductionFileSecurity,
  type WindowsAclAdapter,
  type WindowsAclSnapshot,
} from "../scripts/operator/wallet-store-v2-windows-security.js";

const CREATED_AT = "2026-08-08T18:00:00.000Z";
const PASSWORD = Buffer.from("fixture-production-format-password", "utf8");
const roots: string[] = [];

function privateKey(index: number): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(index + 1, 28);
  return bytes;
}

function testGenerator(retained?: Buffer[]): NodeCSPRNGProductionWalletGenerator {
  let index = 0;
  return NodeCSPRNGProductionWalletGenerator.createForInjectedTests({
    authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    nextBytes: () => {
      const bytes = privateKey(index);
      index += 1;
      retained?.push(bytes);
      return bytes;
    },
  });
}

async function productionFormatBundle(
  createdAt = CREATED_AT,
  storeId = randomUUID(),
): Promise<WalletStoreV2ProductionBundle> {
  const password = new InjectedTestPasswordProvider(PASSWORD, WALLET_STORE_V2_FIXTURE_AUTHORIZATION);
  try {
    return await buildWalletStoreV2ProductionFormatFixtureBundle({
      passwordProvider: password,
      walletGenerator: testGenerator(),
      createdAt,
      storeId,
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    });
  } finally {
    password.destroy();
  }
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

function recomputeProductionFormatFingerprints(bundle: WalletStoreV2ProductionBundle): void {
  for (const record of bundle.envelope.records) {
    const base: Partial<typeof record> = { ...record };
    delete base.recordFingerprint;
    record.recordFingerprint = digest(base);
  }
  bundle.envelope.recordsFingerprint = digest(bundle.envelope.records.map((record) => record.recordFingerprint));
  const envelopeBase: Partial<typeof bundle.envelope> = { ...bundle.envelope };
  delete envelopeBase.encryptedStoreFingerprint;
  delete envelopeBase.manifestFingerprint;
  bundle.envelope.encryptedStoreFingerprint = digest(envelopeBase);
  bundle.manifest.store.encryptedStoreFingerprint = bundle.envelope.encryptedStoreFingerprint;
  const manifestBase: Partial<typeof bundle.manifest> = { ...bundle.manifest };
  delete manifestBase.fingerprint;
  bundle.manifest.fingerprint = digest(manifestBase);
  bundle.envelope.manifestFingerprint = bundle.manifest.fingerprint;
}

class PermissiveCeremonySecurity implements WalletStoreV2CeremonyFileSecurity {
  readonly artifactClass = "production" as const;
  async assertBeforeCreate(): Promise<void> {}
  async assertAfterCommit(): Promise<void> {}
  async assertBeforeOpen(): Promise<void> {}
  async assertPublicFileBeforeCreate(): Promise<void> {}
  async assertPublicFileAfterCommit(): Promise<void> {}
  async assertPublicFileBeforeOpen(): Promise<void> {}
}

class FixtureAclAdapter implements WindowsAclAdapter {
  readonly adapterClass = "windows-acl" as const;
  protected = false;
  async currentUserSid(): Promise<string> { return "S-1-5-21-1000"; }
  async protectDirectory(): Promise<void> { this.protected = true; }
  async inspect(): Promise<WindowsAclSnapshot> {
    return {
      inheritanceProtected: this.protected,
      entries: [
        { sid: "S-1-5-21-1000", type: "Allow", rights: "FullControl" },
        { sid: "S-1-5-18", type: "Allow", rights: "FullControl" },
        { sid: "S-1-5-32-544", type: "Allow", rights: "FullControl" },
      ],
    };
  }
  async isReparsePoint(): Promise<boolean> { return false; }
  async canonicalPath(path: string): Promise<string> { return resolve(path); }
}

class FakeTtyInput extends EventEmitter implements WalletStoreV2TtyInput {
  isTTY = true;
  isRaw = false;
  rawChanges: boolean[] = [];
  resumed = 0;
  paused = 0;
  setRawMode(mode: boolean): void { this.isRaw = mode; this.rawChanges.push(mode); }
  resume(): void { this.resumed += 1; }
  pause(): void { this.paused += 1; }
}

class FakeTtyOutput implements WalletStoreV2TtyOutput {
  isTTY = true;
  values: string[] = [];
  onWrite?: (value: string) => void;
  write(value: string): void { this.values.push(value); this.onWrite?.(value); }
}

function assertTtyClean(input: FakeTtyInput, signal: EventEmitter): void {
  assert.equal(input.isRaw, false);
  assert.equal(input.paused, 1);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(input.listenerCount("end"), 0);
  assert.equal(input.listenerCount("close"), 0);
  assert.equal(input.listenerCount("error"), 0);
  assert.equal(signal.listenerCount("SIGINT"), 0);
}

async function temporaryRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `pop33-ceremony-${label}-${randomUUID()}`);
  await mkdir(root, { recursive: false });
  roots.push(root);
  return root;
}

async function assertNoPlaintextSecretFile(root: string): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const content = await readFile(path, "utf8");
        assert.equal(content.includes(PASSWORD.toString("utf8")), false, path);
        for (const index of [0, 1, 13, 14]) {
          const bytes = privateKey(index);
          try {
            assert.equal(content.includes(bytes.toString("hex")), false, path);
          } finally {
            bytes.fill(0);
          }
        }
      }
    }
  };
  await visit(root);
}

function ceremonyDependencies(input: {
  root: string;
  fault?: WalletStoreV2CeremonyDependencies["fault"];
  build?: WalletStoreV2CeremonyDependencies["buildBundle"];
}): WalletStoreV2CeremonyDependencies {
  const security = new PermissiveCeremonySecurity();
  return {
    paths: walletStoreV2CeremonyPaths(join(input.root, "checkpoint-20")),
    activeSecurity: security,
    backupSecurity: security,
    identitySecurity: security,
    buildBundle: input.build ?? ((createdAt) => productionFormatBundle(createdAt)),
    now: () => CREATED_AT,
    fault: input.fault,
  };
}

describe("Wallet Store v2 ceremony hardening", function () {
  this.timeout(180_000);

  afterEach(async function () {
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
  });

  it("cleans invalid, duplicate, accepted, wrong-length, and failed entropy buffers", function () {
    const retained: Buffer[] = [];
    const invalid = Buffer.alloc(32);
    const first = privateKey(0);
    const duplicate = Buffer.from(first);
    const queue = [invalid, first, duplicate, ...Array.from({ length: 14 }, (_, index) => privateKey(index + 1))];
    const generator = NodeCSPRNGProductionWalletGenerator.createForInjectedTests({
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      nextBytes: () => {
        const value = queue.shift();
        if (!value) throw new Error("fixture exhausted");
        retained.push(value);
        return value;
      },
    });
    const records = generator.generateIndependentSet();
    assert.equal(records.length, 15);
    assert.equal(new Set(records.map((record) => record.address)).size, 15);
    assert.ok(invalid.every((byte) => byte === 0));
    assert.ok(duplicate.every((byte) => byte === 0));
    for (const record of records) record.destroy();
    assert.ok(retained.every((bytes) => bytes.every((byte) => byte === 0)));

    const wrongLength = Buffer.alloc(31, 0xa5);
    const wrongLengthGenerator = NodeCSPRNGProductionWalletGenerator.createForInjectedTests({
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      nextBytes: () => wrongLength,
    });
    assert.throws(() => wrongLengthGenerator.generateIndependentSet(), /failed without exposing/);
    assert.ok(wrongLength.every((byte) => byte === 0));

    const acceptedBeforeFailure = privateKey(0);
    let calls = 0;
    const failing = NodeCSPRNGProductionWalletGenerator.createForInjectedTests({
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      nextBytes: () => {
        calls += 1;
        if (calls === 1) return acceptedBeforeFailure;
        throw new Error("fixture entropy failure");
      },
    });
    assert.throws(() => failing.generateIndependentSet(), /failed without exposing/);
    assert.ok(acceptedBeforeFailure.every((byte) => byte === 0));

    const addressBuffers: Buffer[] = [];
    let derived = 0;
    const duplicateAddressGenerator = NodeCSPRNGProductionWalletGenerator.createForInjectedTests({
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      nextBytes: () => {
        const bytes = privateKey(addressBuffers.length);
        addressBuffers.push(bytes);
        return bytes;
      },
      deriveAddressForTest: (bytes) => {
        derived += 1;
        if (derived <= 2) return "fixture-duplicate-derived-address";
        return `fixture-${bytes.toString("hex")}`;
      },
    });
    const addressRecords = duplicateAddressGenerator.generateIndependentSet();
    assert.equal(addressBuffers.length, 16);
    assert.ok(addressBuffers[1].every((byte) => byte === 0));
    for (const record of addressRecords) record.destroy();
    assert.ok(addressBuffers.every((bytes) => bytes.every((byte) => byte === 0)));

    const derivationFailure = privateKey(0);
    let derivationEntropyCalls = 0;
    const failingDerivation = NodeCSPRNGProductionWalletGenerator.createForInjectedTests({
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      nextBytes: () => {
        derivationEntropyCalls += 1;
        if (derivationEntropyCalls > 1) throw new Error("fixture stop after derivation failure");
        return derivationFailure;
      },
      deriveAddressForTest: () => { throw new Error("fixture derivation failure"); },
    });
    assert.throws(() => failingDerivation.generateIndependentSet(), /failed without exposing/);
    assert.ok(derivationFailure.every((byte) => byte === 0));
  });

  it("cleans all generated records when production-format normalization fails", async function () {
    const retained: Buffer[] = [];
    const password = new InjectedTestPasswordProvider(PASSWORD, WALLET_STORE_V2_FIXTURE_AUTHORIZATION);
    try {
      await assert.rejects(buildWalletStoreV2ProductionFormatFixtureBundle({
        passwordProvider: password,
        walletGenerator: testGenerator(retained),
        createdAt: CREATED_AT,
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        afterGenerationForTest: () => { throw new Error("fixture normalization failure"); },
      }), /failed without exposing/);
      assert.equal(retained.length, 15);
      assert.ok(retained.every((bytes) => bytes.every((byte) => byte === 0)));
    } finally {
      password.destroy();
    }
  });

  it("handles hidden TTY success, UTF-8 byte overflow, EOF, close, error, Ctrl+C, SIGINT, and no TTY", async function () {
    const successInput = new FakeTtyInput();
    const successOutput = new FakeTtyOutput();
    const successSignal = new EventEmitter();
    const success = readHiddenWalletStoreV2PasswordForFixture({
      ttyInput: successInput,
      ttyOutput: successOutput,
      signalSource: successSignal as WalletStoreV2SignalSource,
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    });
    queueMicrotask(() => {
      successInput.emit("data", Buffer.from("fixture-password\bX", "utf8"));
      successInput.emit("data", Buffer.from("\r", "utf8"));
      successInput.emit("end");
    });
    const result = await success;
    assert.equal(result.toString("utf8"), "fixture-passworX");
    result.fill(0);
    assertTtyClean(successInput, successSignal);

    const unicodeBackspaceInput = new FakeTtyInput();
    const unicodeBackspaceOutput = new FakeTtyOutput();
    const unicodeBackspaceSignal = new EventEmitter();
    const unicodeBackspace = readHiddenWalletStoreV2PasswordForFixture({
      ttyInput: unicodeBackspaceInput,
      ttyOutput: unicodeBackspaceOutput,
      signalSource: unicodeBackspaceSignal as WalletStoreV2SignalSource,
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    });
    queueMicrotask(() => unicodeBackspaceInput.emit("data", "é\bX\n"));
    const unicodeBackspaceResult = await unicodeBackspace;
    assert.equal(unicodeBackspaceResult.toString("utf8"), "X");
    unicodeBackspaceResult.fill(0);
    assertTtyClean(unicodeBackspaceInput, unicodeBackspaceSignal);

    for (const [label, trigger, pattern] of [
      ["end", (input: FakeTtyInput) => input.emit("end"), /ended/],
      ["close", (input: FakeTtyInput) => input.emit("close"), /closed/],
      ["error", (input: FakeTtyInput) => input.emit("error", new Error("canary")), /terminal failed/],
      ["ctrl-c", (input: FakeTtyInput) => input.emit("data", Buffer.from([3])), /cancelled/],
    ] as const) {
      const ttyInput = new FakeTtyInput();
      const ttyOutput = new FakeTtyOutput();
      const signal = new EventEmitter();
      const pending = readHiddenWalletStoreV2PasswordForFixture({
        ttyInput,
        ttyOutput,
        signalSource: signal as WalletStoreV2SignalSource,
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      });
      queueMicrotask(() => trigger(ttyInput));
      await assert.rejects(pending, pattern, label);
      assertTtyClean(ttyInput, signal);
    }

    const signalInput = new FakeTtyInput();
    const signalOutput = new FakeTtyOutput();
    const signal = new EventEmitter();
    const interrupted = readHiddenWalletStoreV2PasswordForFixture({
      ttyInput: signalInput,
      ttyOutput: signalOutput,
      signalSource: signal as WalletStoreV2SignalSource,
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    });
    queueMicrotask(() => signal.emit("SIGINT"));
    await assert.rejects(interrupted, /cancelled/);
    assertTtyClean(signalInput, signal);

    const overflowInput = new FakeTtyInput();
    const overflowOutput = new FakeTtyOutput();
    const overflowSignal = new EventEmitter();
    const overflow = readHiddenWalletStoreV2PasswordForFixture({
      ttyInput: overflowInput,
      ttyOutput: overflowOutput,
      signalSource: overflowSignal as WalletStoreV2SignalSource,
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    });
    queueMicrotask(() => overflowInput.emit("data", "€".repeat(86)));
    await assert.rejects(overflow, /byte limit/);
    assertTtyClean(overflowInput, overflowSignal);

    const noTtyInput = new FakeTtyInput();
    noTtyInput.isTTY = false;
    await assert.rejects(readHiddenWalletStoreV2PasswordForFixture({
      ttyInput: noTtyInput,
      ttyOutput: new FakeTtyOutput(),
      signalSource: new EventEmitter() as WalletStoreV2SignalSource,
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    }), /interactive TTY/);
  });

  it("rejects mismatched confirmed hidden passwords and restores the TTY twice", async function () {
    const ttyInput = new FakeTtyInput();
    const ttyOutput = new FakeTtyOutput();
    const signal = new EventEmitter();
    let prompts = 0;
    ttyOutput.onWrite = (value) => {
      if (!value.includes("password:")) return;
      prompts += 1;
      queueMicrotask(() => ttyInput.emit("data", `${prompts === 1 ? "first" : "second"}-fixture-password\r`));
    };
    await assert.rejects(readConfirmedWalletStoreV2PasswordForFixture({
      ttyInput,
      ttyOutput,
      signalSource: signal as WalletStoreV2SignalSource,
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    }), /confirmation failed/);
    assert.equal(ttyInput.paused, 2);
    assert.equal(ttyInput.isRaw, false);
    assert.equal(signal.listenerCount("SIGINT"), 0);
  });

  it("enforces byte-based empty, short, Unicode, multibyte UTF-8, CR, and LF password rules", async function () {
    const runConfirmed = async (value: string, terminator: "\r" | "\n"): Promise<Buffer> => {
      const ttyInput = new FakeTtyInput();
      const ttyOutput = new FakeTtyOutput();
      const signal = new EventEmitter();
      ttyOutput.onWrite = (written) => {
        if (written.includes("password:")) queueMicrotask(() => ttyInput.emit("data", `${value}${terminator}`));
      };
      return readConfirmedWalletStoreV2PasswordForFixture({
        ttyInput,
        ttyOutput,
        signalSource: signal as WalletStoreV2SignalSource,
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      });
    };
    await assert.rejects(runConfirmed("", "\r"), /confirmation failed/);
    await assert.rejects(runConfirmed("short", "\n"), /confirmation failed/);
    for (const [value, terminator] of [
      ["zażółć-gęślą-安全", "\r"],
      ["🔐🔐🔐🔐-fixture", "\n"],
    ] as const) {
      const confirmed = await runConfirmed(value, terminator);
      try {
        assert.equal(confirmed.toString("utf8"), value);
        assert.ok(confirmed.length >= 16);
      } finally {
        confirmed.fill(0);
      }
    }
  });

  it("enforces the exact Windows checkpoint root and only three allowlisted children", async function () {
    const localAppData = await temporaryRoot("root-policy");
    const checkpointRoot = resolve(localAppData, "POP33", "operator", "checkpoint-20");
    const adapter = new FixtureAclAdapter();
    for (const rootDirectory of [
      checkpointRoot,
      resolve(checkpointRoot, "active"),
      resolve(checkpointRoot, "backup"),
      resolve(checkpointRoot, "identity"),
    ]) {
      assert.doesNotThrow(() => new WindowsWalletStoreV2ProductionFileSecurity({
        rootDirectory,
        localAppDataDirectory: localAppData,
        workspaceDirectory: resolve(localAppData, "unrelated-workspace"),
        adapter,
      }));
    }
    for (const broad of [
      localAppData,
      resolve(localAppData, "POP33"),
      resolve(localAppData, "POP33", "operator"),
      resolve(localAppData, "POP33", "operator", "checkpoint-20-prefix-trick"),
      resolve(checkpointRoot, "active-prefix-trick"),
      resolve(checkpointRoot, "other"),
    ]) {
      assert.throws(() => new WindowsWalletStoreV2ProductionFileSecurity({
        rootDirectory: broad,
        localAppDataDirectory: localAppData,
        workspaceDirectory: resolve(localAppData, "unrelated-workspace"),
        adapter,
      }), /checkpoint-20 root|allowlisted/);
    }
  });

  it("completes active store, independent identity, backup, final verification, and blocks regeneration", async function () {
    const root = await temporaryRoot("success");
    let builds = 0;
    const dependencies = ceremonyDependencies({
      root,
      build: async (createdAt) => {
        builds += 1;
        return productionFormatBundle(createdAt);
      },
    });
    const first = await runWalletStoreV2ProductionFormatFixtureCeremony({
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      dependencies,
    });
    assert.equal(first.stage, "complete");
    assert.equal(first.regenerationBlocked, true);
    assert.equal(first.addresses.length, 15);
    assert.match(first.trustedIdentityFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(builds, 1);
    const state = JSON.parse(await readFile(dependencies.paths.stateFile, "utf8")) as { stage: string };
    assert.equal(state.stage, "complete");
    const activeMetadata = JSON.parse(await readFile(
      resolve(dependencies.paths.activeBundleDirectory, WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME),
      "utf8",
    )) as { trustedIdentityFile: string; trustedIdentityFingerprint: string };
    assert.equal(activeMetadata.trustedIdentityFile, dependencies.paths.trustedIdentityFile);
    assert.equal(activeMetadata.trustedIdentityFingerprint, first.trustedIdentityFingerprint);
    const second = await runWalletStoreV2ProductionFormatFixtureCeremony({
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      dependencies,
    });
    assert.equal(second.storeId, first.storeId);
    assert.equal(builds, 1);
    await writeFile(
      resolve(dependencies.paths.activeBundleDirectory, WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME),
      "{}\n",
      "utf8",
    );
    await assert.rejects(runWalletStoreV2ProductionFormatFixtureCeremony({
      authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      dependencies,
    }), /ceremony metadata/);
    assert.equal(builds, 1);
  });

  it("rejects every discovered partial or orphan state before key generation", async function () {
    for (const scenario of [
      "store-without-manifest",
      "store-manifest-without-identity",
      "identity-without-backup",
      "unverified-backup",
      "orphan-temp",
    ] as const) {
      const root = await temporaryRoot(`partial-${scenario}`);
      let builds = 0;
      const dependencies = ceremonyDependencies({
        root,
        build: async (createdAt) => {
          builds += 1;
          return productionFormatBundle(createdAt);
        },
      });
      if (scenario === "store-without-manifest") {
        await mkdir(dependencies.paths.activeBundleDirectory, { recursive: true });
        await writeFile(
          resolve(dependencies.paths.activeBundleDirectory, WALLET_STORE_V2_STORE_FILE_NAME),
          "{}\n",
          "utf8",
        );
      } else if (scenario === "store-manifest-without-identity") {
        await createWalletStoreV2ProductionBundleDirectory({
          directory: dependencies.paths.activeBundleDirectory,
          bundle: await productionFormatBundle(),
          productionSecurity: dependencies.activeSecurity,
        });
      } else if (scenario === "identity-without-backup") {
        await mkdir(dependencies.paths.identityRoot, { recursive: true });
        await writeFile(
          resolve(dependencies.paths.identityRoot, WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME),
          "{}\n",
          "utf8",
        );
      } else if (scenario === "unverified-backup") {
        await mkdir(dependencies.paths.backupBundleDirectory, { recursive: true });
      } else {
        await mkdir(dependencies.paths.activeRoot, { recursive: true });
        await mkdir(
          resolve(dependencies.paths.activeRoot, `.active${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}.${randomUUID()}.tmp`),
        );
      }
      await assert.rejects(runWalletStoreV2ProductionFormatFixtureCeremony({
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        dependencies,
      }), /partial artifacts|unexpected artifact|identity artifact/);
      assert.equal(builds, 0, scenario);
    }
  });

  it("resumes only pre-generation crashes and fail-closes every post-generation crash boundary", async function () {
    for (const resumable of ["after-prepared", "after-paths-verified"] as const) {
      const root = await temporaryRoot(`resume-${resumable}`);
      let tripped = false;
      let builds = 0;
      const dependencies = ceremonyDependencies({
        root,
        fault: (boundary) => {
          if (!tripped && boundary === resumable) {
            tripped = true;
            throw new Error(`fixture crash ${boundary}`);
          }
        },
        build: async (createdAt) => {
          builds += 1;
          return productionFormatBundle(createdAt);
        },
      });
      await assert.rejects(runWalletStoreV2ProductionFormatFixtureCeremony({
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        dependencies,
      }), /fixture crash/);
      const receipt = await runWalletStoreV2ProductionFormatFixtureCeremony({
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        dependencies,
      });
      assert.equal(receipt.stage, "complete");
      assert.equal(builds, 1);
    }

    const blockedBoundaries: readonly WalletStoreV2CeremonyFaultBoundary[] = [
      "after-keys-generating", "after-keys-generated", "before-store-commit", "during-store-commit",
      "after-store-written", "before-identity-write", "during-identity-write", "after-identity-written",
      "before-backup-write", "during-backup-write", "after-backup-written", "after-backup-verified",
      "before-final-verification", "after-final-verification",
    ];
    for (const selected of blockedBoundaries) {
      const root = await temporaryRoot(`blocked-${selected}`);
      let builds = 0;
      const dependencies = ceremonyDependencies({
        root,
        fault: (boundary) => {
          if (boundary === selected) throw new Error(`fixture crash ${boundary}`);
        },
        build: async (createdAt) => {
          builds += 1;
          return productionFormatBundle(createdAt);
        },
      });
      await assert.rejects(runWalletStoreV2ProductionFormatFixtureCeremony({
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        dependencies,
      }), /fixture crash/);
      const buildsAfterCrash = builds;
      await assert.rejects(runWalletStoreV2ProductionFormatFixtureCeremony({
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        dependencies,
      }), /regeneration is forbidden|partial artifacts/);
      assert.equal(builds, buildsAfterCrash, selected);
      await assertNoPlaintextSecretFile(root);
    }
  });

  it("fail-closes entropy crashes after records 1 and 14 and cleans every candidate buffer", async function () {
    for (const acceptedBeforeCrash of [1, 14]) {
      const root = await temporaryRoot(`entropy-crash-${acceptedBeforeCrash}`);
      const retained: Buffer[] = [];
      let calls = 0;
      let builds = 0;
      const dependencies = ceremonyDependencies({
        root,
        build: async (createdAt) => {
          builds += 1;
          const password = new InjectedTestPasswordProvider(PASSWORD, WALLET_STORE_V2_FIXTURE_AUTHORIZATION);
          const generator = NodeCSPRNGProductionWalletGenerator.createForInjectedTests({
            authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
            nextBytes: () => {
              calls += 1;
              if (calls === acceptedBeforeCrash + 1) throw new Error("fixture entropy crash");
              const bytes = privateKey(calls - 1);
              retained.push(bytes);
              return bytes;
            },
          });
          try {
            return await buildWalletStoreV2ProductionFormatFixtureBundle({
              passwordProvider: password,
              walletGenerator: generator,
              createdAt,
              authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
            });
          } finally {
            password.destroy();
          }
        },
      });
      await assert.rejects(runWalletStoreV2ProductionFormatFixtureCeremony({
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        dependencies,
      }), /failed without exposing/);
      assert.ok(retained.every((bytes) => bytes.every((byte) => byte === 0)));
      await assert.rejects(runWalletStoreV2ProductionFormatFixtureCeremony({
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        dependencies,
      }), /regeneration is forbidden/);
      assert.equal(builds, 1);
    }
  });

  it("uses production-format fixtures for backup, trusted restore, and exactly one selected record", async function () {
    const root = await temporaryRoot("production-format-restore");
    const paths = walletStoreV2CeremonyPaths(join(root, "checkpoint-20"));
    const security = new PermissiveCeremonySecurity();
    const bundle = await productionFormatBundle();
    const identity = buildTrustedWalletStoreIdentity(bundle.manifest);
    await createWalletStoreV2ProductionBundleDirectory({
      directory: paths.activeBundleDirectory,
      bundle,
      productionSecurity: security,
    });
    await createWalletStoreV2ProductionBackup({
      sourceDirectory: paths.activeBundleDirectory,
      backupDirectory: paths.backupBundleDirectory,
      expectedIdentity: identity,
      sourceSecurity: security,
      backupSecurity: security,
    });
    const restoreDirectory = resolve(paths.activeRoot, `restore.checkpoint-20-wallet-store-v2-bundle`);
    await restoreWalletStoreV2ProductionBackup({
      backupDirectory: paths.backupBundleDirectory,
      restoreDirectory,
      expectedIdentity: identity,
      backupSecurity: security,
      restoreSecurity: security,
    });
    const selected: number[] = [];
    const password = new InjectedTestPasswordProvider(PASSWORD, WALLET_STORE_V2_FIXTURE_AUTHORIZATION);
    try {
      const receipt = await verifyDecryptedWalletStoreV2ProductionFormatFixtureRecord({
        directory: restoreDirectory,
        index: 9,
        passwordProvider: password,
        productionSecurity: security,
        expectedIdentity: identity,
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        onRecordDecrypted: (index) => selected.push(index),
      });
      assert.deepEqual(selected, [9]);
      assert.equal(receipt.index, 9);
      assert.equal(receipt.address, bundle.manifest.candidates[9].address);
    } finally {
      password.destroy();
    }
  });

  it("rejects substituted, stale, rollback, wrong-identity, and overwrite production-format restores", async function () {
    const security = new PermissiveCeremonySecurity();
    const expectedStoreId = "70707070-7070-4070-8070-707070707070";
    const expectedBundle = await productionFormatBundle(CREATED_AT, expectedStoreId);
    const expectedIdentity = buildTrustedWalletStoreIdentity(expectedBundle.manifest);
    for (const [label, candidate] of [
      ["substituted", await productionFormatBundle(CREATED_AT, "71717171-7171-4171-8171-717171717171")],
      ["stale", await productionFormatBundle("2026-08-07T18:00:00.000Z", expectedStoreId)],
      ["rollback", await productionFormatBundle("2026-08-06T18:00:00.000Z", expectedStoreId)],
    ] as const) {
      const root = await temporaryRoot(`restore-${label}`);
      const paths = walletStoreV2CeremonyPaths(join(root, "checkpoint-20"));
      await createWalletStoreV2ProductionBundleDirectory({
        directory: paths.activeBundleDirectory,
        bundle: candidate,
        productionSecurity: security,
      });
      await createWalletStoreV2ProductionBackup({
        sourceDirectory: paths.activeBundleDirectory,
        backupDirectory: paths.backupBundleDirectory,
        expectedIdentity: buildTrustedWalletStoreIdentity(candidate.manifest),
        sourceSecurity: security,
        backupSecurity: security,
      });
      await assert.rejects(restoreWalletStoreV2ProductionBackup({
        backupDirectory: paths.backupBundleDirectory,
        restoreDirectory: resolve(paths.activeRoot, `restore${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`),
        expectedIdentity,
        backupSecurity: security,
        restoreSecurity: security,
      }), /trusted identity/);
    }

    const root = await temporaryRoot("restore-wrong-and-overwrite");
    const paths = walletStoreV2CeremonyPaths(join(root, "checkpoint-20"));
    await createWalletStoreV2ProductionBundleDirectory({
      directory: paths.activeBundleDirectory,
      bundle: expectedBundle,
      productionSecurity: security,
    });
    await createWalletStoreV2ProductionBackup({
      sourceDirectory: paths.activeBundleDirectory,
      backupDirectory: paths.backupBundleDirectory,
      expectedIdentity,
      sourceSecurity: security,
      backupSecurity: security,
    });
    const wrongIdentity = buildTrustedWalletStoreIdentity(
      (await productionFormatBundle(CREATED_AT, "72727272-7272-4272-8272-727272727272")).manifest,
    );
    await assert.rejects(restoreWalletStoreV2ProductionBackup({
      backupDirectory: paths.backupBundleDirectory,
      restoreDirectory: resolve(paths.activeRoot, `wrong${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`),
      expectedIdentity: wrongIdentity,
      backupSecurity: security,
      restoreSecurity: security,
    }), /trusted identity/);
    await assert.rejects(restoreWalletStoreV2ProductionBackup({
      backupDirectory: paths.backupBundleDirectory,
      restoreDirectory: paths.activeBundleDirectory,
      expectedIdentity,
      backupSecurity: security,
      restoreSecurity: security,
    }), /already exists|overwrite is forbidden/);
  });

  it("does not decrypt corrupt record 10 while unlocking record 3, then fail-closes record 10", async function () {
    const root = await temporaryRoot("one-record-isolation");
    const paths = walletStoreV2CeremonyPaths(join(root, "checkpoint-20"));
    const security = new PermissiveCeremonySecurity();
    const bundle = structuredClone(await productionFormatBundle());
    bundle.envelope.records[10].ciphertext = Buffer.alloc(32, 0xa5).toString("base64");
    recomputeProductionFormatFingerprints(bundle);
    const identity = buildTrustedWalletStoreIdentity(bundle.manifest);
    await createWalletStoreV2ProductionBundleDirectory({
      directory: paths.activeBundleDirectory,
      bundle,
      productionSecurity: security,
    });
    const selected: number[] = [];
    const password = new InjectedTestPasswordProvider(PASSWORD, WALLET_STORE_V2_FIXTURE_AUTHORIZATION);
    try {
      const record3 = await verifyDecryptedWalletStoreV2ProductionFormatFixtureRecord({
        directory: paths.activeBundleDirectory,
        index: 3,
        passwordProvider: password,
        productionSecurity: security,
        expectedIdentity: identity,
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        onRecordDecrypted: (index) => selected.push(index),
      });
      assert.equal(record3.index, 3);
      assert.deepEqual(selected, [3]);
      await assert.rejects(verifyDecryptedWalletStoreV2ProductionFormatFixtureRecord({
        directory: paths.activeBundleDirectory,
        index: 10,
        passwordProvider: password,
        productionSecurity: security,
        expectedIdentity: identity,
        authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        onRecordDecrypted: (index) => selected.push(index),
      }), /failed without exposing/);
      assert.deepEqual(selected, [3]);
    } finally {
      password.destroy();
    }
  });
});
