import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FULL_LIFECYCLE_99_CONFIRMATION,
  FULL_LIFECYCLE_99_STORE_FILE_NAME,
  FULL_LIFECYCLE_WALLET_COUNT,
  buildFullLifecycle99Inspection,
  fullLifecycle99DryRunSummary,
  fullLifecycle99InitializationSummary,
  fullLifecycle99InspectionSummary,
  initializeFullLifecycle99Store,
  inspectFullLifecycle99Store,
  planFullLifecycle99Initialization,
} from "../scripts/operator/full-lifecycle-wallet-store.js";
import { PILOT_SET_FILES } from "../scripts/operator/pilot-set-initializer.js";

const TEST_PASSWORD = "fixture-only-full-lifecycle-password-123";
const PRIVATE_KEY_LIKE_SECRET = `0x${"ab".repeat(32)}`;
const directories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pop33-full-lifecycle-store-"));
  directories.push(root);
  return root;
}

describe("full-lifecycle 99-wallet store initializer and inspector", function () {
  this.timeout(30_000);

  afterEach(async function () {
    while (directories.length > 0) {
      await rm(directories.pop()!, { recursive: true, force: true });
    }
  });

  it("keeps dry-run write-free and wallet-generation-free", async function () {
    const root = await temporaryRoot();
    const targetDirectory = join(root, "set-99");
    const plan = await planFullLifecycle99Initialization({ targetDirectory });
    assert.equal(plan.walletCount, 99);
    assert.equal(plan.targetExists, false);
    assert.equal(plan.writePerformed, false);
    assert.equal(plan.walletMaterialGenerated, false);
    assert.equal(plan.targetFile, join(targetDirectory, FULL_LIFECYCLE_99_STORE_FILE_NAME));
    assert.deepEqual(await readdir(root), []);
  });

  it("has no import-time filesystem side effect", async function () {
    const root = await temporaryRoot();
    process.env.POP33_FULL_LIFECYCLE_TARGET_DIRECTORY = join(root, "must-not-exist");
    try {
      await import(`../scripts/operator/full-lifecycle-wallet-store.js?side-effect=${Date.now()}`);
      await import(`../scripts/full-lifecycle-99-wallet-store-cli.mjs?side-effect=${Date.now()}`);
    } finally {
      delete process.env.POP33_FULL_LIFECYCLE_TARGET_DIRECTORY;
    }
    assert.deepEqual(await readdir(root), []);
  });

  it("requires exact confirmation and rejects every count other than 99 before writing", async function () {
    const root = await temporaryRoot();
    for (const input of [
      { walletCount: 98, confirmation: FULL_LIFECYCLE_99_CONFIRMATION },
      { walletCount: 100, confirmation: FULL_LIFECYCLE_99_CONFIRMATION },
      { walletCount: 99, confirmation: "CREATE SOMETHING ELSE" },
    ]) {
      await assert.rejects(initializeFullLifecycle99Store({
        targetDirectory: join(root, `rejected-${input.walletCount}-${input.confirmation.length}`),
        password: TEST_PASSWORD,
        repeatedPassword: TEST_PASSWORD,
        confirmation: input.confirmation,
        walletCount: input.walletCount,
      }), /exactly 99|requires exact confirmation/);
    }
    assert.deepEqual(await readdir(root), []);
  });

  it("creates only one isolated encrypted fixture, validates it, and refuses overwrite", async function () {
    const root = await temporaryRoot();
    const targetDirectory = join(root, "set-99");
    const pilotStore = join(root, PILOT_SET_FILES.walletStore);
    const pilotSentinel = "pilot-store-must-remain-byte-for-byte-unchanged";
    await writeFile(pilotStore, pilotSentinel, "utf8");

    const result = await initializeFullLifecycle99Store({
      targetDirectory,
      password: TEST_PASSWORD,
      repeatedPassword: TEST_PASSWORD,
      confirmation: FULL_LIFECYCLE_99_CONFIRMATION,
    });
    assert.equal(result.walletCount, FULL_LIFECYCLE_WALLET_COUNT);
    assert.notEqual(result.targetFile, pilotStore);
    assert.equal(await readFile(pilotStore, "utf8"), pilotSentinel);
    assert.deepEqual(await readdir(targetDirectory), [FULL_LIFECYCLE_99_STORE_FILE_NAME]);
    assert.equal((await readdir(targetDirectory)).some((name) => /journal|checkpoint/i.test(name)), false);
    assert.equal((await readdir(targetDirectory)).some((name) => /\.tmp|validation/i.test(name)), false);

    await assert.rejects(initializeFullLifecycle99Store({
      targetDirectory,
      password: TEST_PASSWORD,
      repeatedPassword: TEST_PASSWORD,
      confirmation: FULL_LIFECYCLE_99_CONFIRMATION,
    }), /will not overwrite/);
  });

  it("inspects only public fields and leaves the encrypted fixture byte-for-byte unchanged", async function () {
    const root = await temporaryRoot();
    const targetDirectory = join(root, "set-99");
    const result = await initializeFullLifecycle99Store({
      targetDirectory,
      password: TEST_PASSWORD,
      repeatedPassword: TEST_PASSWORD,
      confirmation: FULL_LIFECYCLE_99_CONFIRMATION,
    });
    const before = await readFile(result.targetFile, "utf8");
    const report = await inspectFullLifecycle99Store({ targetDirectory, password: TEST_PASSWORD });
    const after = await readFile(result.targetFile, "utf8");

    assert.equal(report.walletCount, 99);
    assert.equal(report.wallets.length, 99);
    assert.equal(new Set(report.wallets.map((wallet) => wallet.address.toLowerCase())).size, 99);
    assert.equal(report.exactly99Wallets, true);
    assert.equal(report.structureValid, true);
    assert.deepEqual(report.missingIndices, []);
    assert.deepEqual(report.duplicateAddresses, []);
    assert.equal(report.rpcUsed, false);
    assert.equal(report.writePerformed, false);
    assert.equal(report.createdAt, null);
    assert.equal(after, before);
    assert.doesNotMatch(JSON.stringify(report), /privateKey|mnemonic|password|ciphertext|authTag|\bkdf\b/i);
    assert.doesNotMatch(before, /"privateKey"\s*:/i);
    assert.equal(before.includes(TEST_PASSWORD), false);
  });

  it("detects missing and duplicate public addresses without returning secret fields", function () {
    const first = "0x1111111111111111111111111111111111111111";
    const report = buildFullLifecycle99Inspection({
      formatVersion: 1,
      storeId: "fixture-store-id-safe-for-public-report",
      walletCount: 3,
      addresses: [first, first, ""],
      fingerprint: `sha256:${"a".repeat(64)}`,
    });
    assert.deepEqual(report.missingIndices, [2]);
    assert.deepEqual(report.duplicateAddresses, [first]);
    assert.equal(report.exactly99Wallets, false);
    assert.equal(report.structureValid, false);
    assert.doesNotMatch(JSON.stringify(report), /privateKey|mnemonic|password|ciphertext/i);
  });

  it("keeps summaries free of passwords, private-key-like values, and encrypted payloads", async function () {
    const root = await temporaryRoot();
    const targetDirectory = join(root, "set-99");
    const plan = await planFullLifecycle99Initialization({ targetDirectory });
    const result = {
      targetFile: plan.targetFile,
      walletCount: 99 as const,
      storeId: "fixture-public-store-id",
      fingerprint: `sha256:${"b".repeat(64)}`,
    };
    const report = buildFullLifecycle99Inspection({
      formatVersion: 1,
      storeId: result.storeId,
      walletCount: 99,
      addresses: Array.from({ length: 99 }, (_, index) =>
        `0x${(index + 1).toString(16).padStart(40, "0")}`,
      ),
      fingerprint: result.fingerprint,
    });
    const output = [
      fullLifecycle99DryRunSummary(plan),
      fullLifecycle99InitializationSummary(result),
      fullLifecycle99InspectionSummary(report),
    ].join("\n");
    assert.equal(output.includes(TEST_PASSWORD), false);
    assert.equal(output.includes(PRIVATE_KEY_LIKE_SECRET), false);
    assert.doesNotMatch(output, /ciphertext|authTag|mnemonic\s*[:=]|password\s*[:=]/i);
  });

  it("keeps pilot paths separate and contains no RPC, signer, or transaction transport", async function () {
    assert.notEqual(FULL_LIFECYCLE_99_STORE_FILE_NAME, PILOT_SET_FILES.walletStore);
    const root = await temporaryRoot();
    await writeFile(join(root, PILOT_SET_FILES.walletStore), "pilot-sentinel", "utf8");
    await assert.rejects(
      planFullLifecycle99Initialization({ targetDirectory: root }),
      /must be isolated/,
    );
    const source = await readFile(
      new URL("../scripts/operator/full-lifecycle-wallet-store.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /JsonRpcProvider|sendTransaction|sendRawTransaction|signTransaction|broadcast|writeContract|walletClient|\bSigner\b|https?:\/\//i,
    );
    assert.doesNotMatch(
      source,
      /from\s+["'].\/(?:transaction-journal|transaction-recovery|checkpoint)\.js["']/i,
    );
  });

  it("uses hidden password prompts and clears child-process secrets", async function () {
    const source = await readFile(
      new URL("../scripts/full-lifecycle-99-wallet-store.ps1", import.meta.url),
      "utf8",
    );
    assert.equal((source.match(/-AsSecureString/g) ?? []).length, 3);
    assert.match(source, /ZeroFreeBSTR/);
    assert.match(source, /ProcessStartInfo/);
    assert.match(source, /EnvironmentVariables\.Remove\(\$Name\)/);
    assert.doesNotMatch(source, /\$env:POP33_FULL_LIFECYCLE_PASSWORD/);
    assert.doesNotMatch(source, new RegExp(TEST_PASSWORD, "i"));
  });
});
