import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEMO_V1_PARAMETERS } from "../scripts/lib/demo-v1-config.js";
import { auditBaseSepoliaOperatorArtifacts } from "../scripts/operator/base-sepolia-artifact-audit.js";
import {
  PUBLIC_OPERATOR_CHAIN_ID,
  PUBLIC_OPERATOR_TOKEN_ADDRESS,
  runBaseSepoliaReadOnlyOperator,
  type PublicContractIdentity,
  type PublicPoolSnapshot,
  type PublicReadOnlyRuntime,
  type PublicRoundSnapshot,
  type PublicWalletSnapshot,
} from "../scripts/operator/base-sepolia-read-only-operator.js";
import {
  PILOT_SET_CHAIN_ID,
  PILOT_SET_PROJECT,
  PILOT_SET_PURPOSE,
  walletOrderDigest,
} from "../scripts/operator/operator-set-identity.js";
import {
  PILOT_INITIALIZER_CONFIRMATION,
  PILOT_SET_FILES,
  assertMatchingPilotPasswords,
  initializePilotOperatorSet,
  openPilotOperatorSet,
  pilotSetPublicSummary,
} from "../scripts/operator/pilot-set-initializer.js";

const TEST_PASSWORD = "fixture-only-password-123";
const WRONG_PASSWORD = "fixture-only-password-999";
const directories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pop33-pilot-initializer-"));
  directories.push(root);
  return root;
}

async function createFixture() {
  const root = await temporaryRoot();
  const targetDirectory = join(root, "pilot-set");
  const result = await initializePilotOperatorSet({
    targetDirectory,
    password: TEST_PASSWORD,
    repeatedPassword: TEST_PASSWORD,
    confirmation: PILOT_INITIALIZER_CONFIRMATION,
  });
  return { root, targetDirectory, result };
}

function paths(directory: string) {
  return {
    walletStore: join(directory, PILOT_SET_FILES.walletStore),
    checkpoint: join(directory, PILOT_SET_FILES.checkpoint),
    journal: join(directory, PILOT_SET_FILES.transactionJournal),
    manifest: join(directory, PILOT_SET_FILES.manifest),
  };
}

interface MutableJsonState {
  binding?: Record<string, unknown>;
  setBinding?: Record<string, unknown>;
  walletAddresses?: string[];
}

async function readJson(filePath: string): Promise<MutableJsonState> {
  return JSON.parse(await readFile(filePath, "utf8")) as MutableJsonState;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireBinding(value: MutableJsonState): Record<string, unknown> {
  const binding = value.binding ?? value.setBinding;
  if (!binding) throw new Error("Test fixture lacks a binding.");
  return binding;
}

function requireWalletAddresses(value: MutableJsonState): string[] {
  if (!value.walletAddresses) throw new Error("Test fixture lacks wallet addresses.");
  return value.walletAddresses;
}

function artifactEnvironment(directory: string): NodeJS.ProcessEnv {
  const files = paths(directory);
  return {
    OPERATOR_WALLET_STORE_PATH: files.walletStore,
    OPERATOR_WALLET_STORE_PASSWORD: TEST_PASSWORD,
    OPERATOR_SET_MANIFEST_PATH: files.manifest,
    OPERATOR_CHECKPOINT_PATH: files.checkpoint,
    OPERATOR_TRANSACTION_JOURNAL_PATH: files.journal,
    OPERATOR_REQUIRED_CONFIRMATIONS: "3",
  };
}

class PilotFakeRuntime implements PublicReadOnlyRuntime {
  private readonly identity: PublicContractIdentity = {
    paymentToken: PUBLIC_OPERATOR_TOKEN_ADDRESS,
    tokenName: "POP33 Demo USD",
    tokenSymbol: "dUSDC",
    tokenDecimals: 6n,
    dripAmount: DEMO_V1_PARAMETERS.dripAmount,
    dripCooldown: DEMO_V1_PARAMETERS.dripCooldownSeconds,
    entryAmount: DEMO_V1_PARAMETERS.entryPrice,
    maxParticipants: DEMO_V1_PARAMETERS.positionsPerPool,
    maxActivePositions: 10n,
    roundCount: DEMO_V1_PARAMETERS.drawRoundCount,
    drawInterval: DEMO_V1_PARAMETERS.drawIntervalSeconds,
    poolCount: 1n,
  };
  private readonly pool: PublicPoolSnapshot = {
    id: 1n,
    status: 0n,
    activePositionCount: 0n,
    escrowedAmount: 0n,
    lockedAt: 0n,
    completedDrawRoundCount: 0n,
    claimedPrizeCount: 0n,
  };

  async getChainId() { return PUBLIC_OPERATOR_CHAIN_ID; }
  async getLatestBlockNumber() { return 1_000; }
  async getLatestBlockTimestamp() { return 2_000_000_000n; }
  async getCode() { return "0x6001"; }
  async getFeePerGas() { return 10_000_000n; }
  async getContractIdentity() { return this.identity; }
  async getOpenPoolIds() { return [1n]; }
  async getPool() { return this.pool; }
  async getRounds(_poolId: bigint, count: bigint): Promise<PublicRoundSnapshot[]> {
    return Array.from({ length: Number(count) }, (_, index) => ({
      number: BigInt(index + 1),
      scheduledAt: 0n,
      executedAt: 0n,
      status: 0n,
      winningPositionId: 0n,
      winner: "0x0000000000000000000000000000000000000000",
      claimed: false,
    }));
  }
  async getWallet(address: string): Promise<PublicWalletSnapshot> {
    return {
      address,
      nativeBalance: 10n ** 18n,
      tokenBalance: 0n,
      allowance: 0n,
      nextDripAt: 0n,
      activePositions: 0n,
      activePositionId: 0n,
      claimablePrizes: 0n,
      nonceLatest: 0,
      noncePending: 0,
    };
  }
  async estimateAction() { return 50_000n; }
}

describe("secure five-wallet pilot set initializer", function () {
  afterEach(async function () {
    while (directories.length > 0) await rm(directories.pop()!, { recursive: true, force: true });
  });

  it("creates exactly five unique encrypted wallets with one shared binding", async function () {
    const fixture = await createFixture();
    const opened = await openPilotOperatorSet({
      directory: fixture.targetDirectory,
      password: TEST_PASSWORD,
    });
    assert.equal(opened.walletAddresses.length, 5);
    assert.equal(new Set(opened.walletAddresses.map((address) => address.toLowerCase())).size, 5);
    assert.equal(opened.binding.project, PILOT_SET_PROJECT);
    assert.equal(opened.binding.purpose, PILOT_SET_PURPOSE);
    assert.equal(opened.binding.chainId, PILOT_SET_CHAIN_ID.toString());
    assert.equal(opened.binding.walletOrderDigest, walletOrderDigest(opened.walletAddresses));
    assert.equal(opened.checkpoint.setBinding?.storeId, opened.binding.storeId);
    assert.equal(opened.journal.setBinding?.storeId, opened.binding.storeId);
  });

  it("rejects a wrong password and mismatched password entries", async function () {
    const fixture = await createFixture();
    await assert.rejects(openPilotOperatorSet({
      directory: fixture.targetDirectory,
      password: WRONG_PASSWORD,
    }), /wrong password or file integrity failure/);
    assert.throws(() => assertMatchingPilotPasswords(TEST_PASSWORD, WRONG_PASSWORD), /do not match/);
  });

  it("requires the exact confirmation before generating wallets", async function () {
    const root = await temporaryRoot();
    await assert.rejects(initializePilotOperatorSet({
      targetDirectory: join(root, "pilot-set"),
      password: TEST_PASSWORD,
      repeatedPassword: TEST_PASSWORD,
      confirmation: "CREATE SOMETHING ELSE",
    }), /requires exact confirmation/);
  });

  it("refuses to overwrite an existing pilot directory", async function () {
    const fixture = await createFixture();
    await assert.rejects(initializePilotOperatorSet({
      targetDirectory: fixture.targetDirectory,
      password: TEST_PASSWORD,
      repeatedPassword: TEST_PASSWORD,
      confirmation: PILOT_INITIALIZER_CONFIRMATION,
    }), /will not overwrite/);
  });

  it("rejects a target inside the repository workspace", async function () {
    const inside = join(process.cwd(), ".forbidden-pilot-set");
    await assert.rejects(initializePilotOperatorSet({
      targetDirectory: inside,
      password: TEST_PASSWORD,
      repeatedPassword: TEST_PASSWORD,
      confirmation: PILOT_INITIALIZER_CONFIRMATION,
    }), /outside the workspace/);
  });

  it("hard-stops wrong chain, project, and purpose metadata", async function () {
    for (const mutation of [
      (manifest: MutableJsonState) => { requireBinding(manifest).chainId = "1"; },
      (manifest: MutableJsonState) => { requireBinding(manifest).project = "OTHER"; },
      (manifest: MutableJsonState) => { requireBinding(manifest).purpose = "other-purpose"; },
    ]) {
      const fixture = await createFixture();
      const file = paths(fixture.targetDirectory).manifest;
      const manifest = await readJson(file);
      mutation(manifest);
      await writeJson(file, manifest);
      await assert.rejects(openPilotOperatorSet({
        directory: fixture.targetDirectory,
        password: TEST_PASSWORD,
      }), /mismatch/);
    }
  });

  it("hard-stops a mismatched store ID in manifest, checkpoint, or journal", async function () {
    for (const fileName of ["manifest", "checkpoint", "journal"] as const) {
      const fixture = await createFixture();
      const file = paths(fixture.targetDirectory)[fileName];
      const value = await readJson(file);
      const binding = requireBinding(value);
      binding.storeId = randomUUID();
      await writeJson(file, value);
      await assert.rejects(openPilotOperatorSet({
        directory: fixture.targetDirectory,
        password: TEST_PASSWORD,
      }), /store ID|binding mismatch/);
    }
  });

  it("hard-stops changed wallet order", async function () {
    const fixture = await createFixture();
    const file = paths(fixture.targetDirectory).manifest;
    const manifest = await readJson(file);
    const addresses = requireWalletAddresses(manifest);
    [addresses[0], addresses[1]] = [
      addresses[1], addresses[0],
    ];
    await writeJson(file, manifest);
    await assert.rejects(openPilotOperatorSet({
      directory: fixture.targetDirectory,
      password: TEST_PASSWORD,
    }), /wallet order/);
  });

  it("rejects corrupted checkpoint and journal files", async function () {
    for (const fileName of ["checkpoint", "journal"] as const) {
      const fixture = await createFixture();
      await writeFile(paths(fixture.targetDirectory)[fileName], "{truncated", "utf8");
      await assert.rejects(openPilotOperatorSet({
        directory: fixture.targetDirectory,
        password: TEST_PASSWORD,
      }), /invalid JSON/);
    }
  });

  it("prints neither password nor private keys in its public summary or state files", async function () {
    const fixture = await createFixture();
    const summary = pilotSetPublicSummary(fixture.result);
    assert.doesNotMatch(summary, new RegExp(TEST_PASSWORD, "i"));
    assert.doesNotMatch(summary, /private.?key\s*[:=]\s*0x/i);
    for (const file of Object.values(paths(fixture.targetDirectory))) {
      const content = await readFile(file, "utf8");
      assert.equal(content.includes(TEST_PASSWORD), false);
      assert.doesNotMatch(content, /"privateKey"\s*:/i);
    }
  });

  it("opens the same set repeatedly without modifying identity or order", async function () {
    const fixture = await createFixture();
    const first = await openPilotOperatorSet({ directory: fixture.targetDirectory, password: TEST_PASSWORD });
    const second = await openPilotOperatorSet({ directory: fixture.targetDirectory, password: TEST_PASSWORD });
    assert.deepEqual(second.walletAddresses, first.walletAddresses);
    assert.deepEqual(second.binding, first.binding);
    assert.equal(second.journal.revision, 0);
    assert.equal(second.checkpoint.revision, 0);
  });

  it("feeds safe read-only dry-runs for the first two and all five wallets", async function () {
    const fixture = await createFixture();
    const artifactPaths = Object.values(paths(fixture.targetDirectory));
    const before = await Promise.all(artifactPaths.map((file) => readFile(file, "utf8")));
    const artifacts = await auditBaseSepoliaOperatorArtifacts(
      1_000,
      artifactEnvironment(fixture.targetDirectory),
    );
    assert.ok(artifacts.checks.every((check) => check.ok));
    for (const walletCount of [2, 5]) {
      const report = await runBaseSepoliaReadOnlyOperator({
        runtime: new PilotFakeRuntime(),
        mode: "dry-run",
        walletCount,
        artifacts,
        now: new Date("2026-07-18T12:00:00.000Z"),
      });
      assert.equal(report.wallets.length, walletCount);
      assert.equal(report.readOnly, true);
      assert.equal(report.readyForSeparatelyAuthorizedPilot, true);
    }
    const after = await Promise.all(artifactPaths.map((file) => readFile(file, "utf8")));
    assert.deepEqual(after, before);
  });

  it("keeps every write primitive absent from initializer and public runtime sources", async function () {
    for (const relative of [
      "../scripts/operator/pilot-set-initializer.ts",
      "../scripts/operator/ethers-base-sepolia-read-only-runtime.ts",
    ]) {
      const source = await readFile(new URL(relative, import.meta.url), "utf8");
      assert.doesNotMatch(source, /sendTransaction|writeContract|walletClient|sendRawTransaction|\bSigner\b|deployer/i);
    }
  });

  it("uses two hidden SecureString prompts and clears child-process secrets", async function () {
    const source = await readFile(
      new URL("../scripts/initialize-base-sepolia-pilot-5.ps1", import.meta.url),
      "utf8",
    );
    assert.equal((source.match(/-AsSecureString/g) ?? []).length, 2);
    assert.match(source, /ZeroFreeBSTR/);
    assert.match(source, /ProcessStartInfo/);
    assert.match(source, /EnvironmentVariables\.Remove\('POP33_PILOT_PASSWORD_FIRST'\)/);
    assert.match(source, /EnvironmentVariables\.Remove\('POP33_PILOT_PASSWORD_SECOND'\)/);
    assert.doesNotMatch(source, /\$env:POP33_PILOT_PASSWORD/);
    assert.doesNotMatch(source, new RegExp(TEST_PASSWORD, "i"));
  });
});
