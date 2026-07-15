import { expect } from "chai";

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseEther, Wallet } from "ethers";

import { network } from "hardhat";

import { DEMO_V1_PARAMETERS } from "../scripts/lib/demo-v1-config.js";
import { deployLocalDemoV1 } from "../scripts/lib/local-demo.js";
import {
  assertClosedCheckpointSchema,
  assertCheckpointContainsNoSecretFields,
  JsonCheckpointStore,
  MemoryCheckpointStore,
  OPERATOR_WORKSPACE_ROOT,
  type OperatorCheckpoint,
} from "../scripts/operator/checkpoint.js";
import {
  DemoV1Operator,
  POOL_STATUS,
} from "../scripts/operator/demo-v1-operator.js";
import {
  assertExecutionPolicy,
  BASE_SEPOLIA_WRITE_CONFIRMATION,
  isWriteMode,
  OPERATOR_MODES,
} from "../scripts/operator/network-policy.js";
import { EphemeralLocalWalletProvider } from "../scripts/operator/wallet-provider.js";

const connection = await network.create({ network: "hardhatOp", chainType: "op" });
const { networkHelpers } = connection;
const silent = () => undefined;
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-operator-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async function () {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

function validCheckpoint(walletCount = 1): OperatorCheckpoint {
  return {
    schemaVersion: 1,
    revision: 0,
    chainId: "31337",
    tokenAddress: "0x0000000000000000000000000000000000000001",
    contractAddress: "0x0000000000000000000000000000000000000002",
    poolId: "1",
    poolStatus: "0",
    activePositionCount: "0",
    escrowedAmount: "0",
    completedDrawRoundCount: "0",
    claimedPrizeCount: "0",
    updatedAt: "2026-07-15T00:00:00.000Z",
    operatorTransactions: [],
    wallets: Array.from({ length: walletCount }, (_, index) => ({
      index,
      address: `0x${(index + 10).toString(16).padStart(40, "0")}`,
      stage: "discovered" as const,
      nativeBalance: "0",
      tokenBalance: "0",
      allowance: "0",
      activePositionId: "0",
      poolId: "1",
      winningRounds: [],
      claimedRounds: [],
      transactions: [],
    })),
  };
}

async function baseOperatorFixture() {
  const deployed = await deployLocalDemoV1(connection, false);
  const walletProvider = EphemeralLocalWalletProvider.create(100, deployed.ethers.provider);
  const runtime = {
    network: "hardhatOp" as const,
    provider: deployed.ethers.provider,
    networkHelpers: deployed.networkHelpers,
    token: deployed.token,
    pop33: deployed.pop33,
    drawExecutor: deployed.deployer,
  };
  return { deployed, walletProvider, runtime };
}

async function approvedOperatorFixture() {
  const fixture = await baseOperatorFixture();
  const operator = new DemoV1Operator({
    runtime: fixture.runtime,
    wallets: fixture.walletProvider,
    checkpointStore: new MemoryCheckpointStore(),
    log: silent,
  });
  await operator.fund();
  await operator.drip();
  await operator.approve();
  return { ...fixture, operator };
}

async function readyAt99Fixture() {
  const fixture = await approvedOperatorFixture();
  await fixture.operator.joinTo99();
  return fixture;
}

function newOperator(
  fixture: Awaited<ReturnType<typeof baseOperatorFixture>>,
  checkpointStore = new MemoryCheckpointStore(),
) {
  return new DemoV1Operator({
    runtime: fixture.runtime,
    wallets: fixture.walletProvider,
    checkpointStore,
    log: silent,
  });
}

async function expectFailure(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect((error as Error).message).to.include(message);
    return;
  }
  expect.fail(`Expected failure containing: ${message}`);
}

describe("Demo V1 local multi-wallet operator", function () {
  it("blocks every Base Sepolia write and requires all future safety gates", function () {
    expect(() =>
      assertExecutionPolicy({ mode: "preflight", network: "baseSepolia" }),
    ).not.to.throw();
    expect(() =>
      assertExecutionPolicy({ mode: "join-to-99", network: "baseSepolia" }),
    ).to.throw("public execution flag");
    expect(() =>
      assertExecutionPolicy({
        mode: "join-to-99",
        network: "baseSepolia",
        executePublic: true,
      }),
    ).to.throw("exact confirmation phrase");
    expect(() =>
      assertExecutionPolicy({
        mode: "join-to-99",
        network: "baseSepolia",
        executePublic: true,
        confirmation: BASE_SEPOLIA_WRITE_CONFIRMATION,
      }),
    ).to.throw("public write execution is not implemented");

    for (const mode of OPERATOR_MODES.filter(isWriteMode)) {
      expect(() =>
        assertExecutionPolicy({
          mode,
          network: "baseSepolia",
          executePublic: true,
          confirmation: BASE_SEPOLIA_WRITE_CONFIRMATION,
        }),
      ).to.throw("public write execution is not implemented");
    }
  });

  it("blocks every write mode when hardhatOp reports the wrong chain ID", async function () {
    const runtime = {
      network: "hardhatOp",
      provider: { getNetwork: async () => ({ chainId: 84_532n }) },
      token: {},
      pop33: {},
      drawExecutor: { address: "0x0000000000000000000000000000000000000001" },
    };
    const wallets = {
      kind: "local-ephemeral",
      supportsProcessRestart: false,
      listWallets: () => [],
      findWallet: () => undefined,
    };
    const operator = new DemoV1Operator({
      runtime: runtime as never,
      wallets: wallets as never,
      checkpointStore: new MemoryCheckpointStore(),
      log: silent,
    });
    const attempts = [
      () => operator.fund(),
      () => operator.drip(),
      () => operator.approve(),
      () => operator.joinTo99(),
      () => operator.finalJoin("wrong"),
      () => operator.withdrawAllBeforeLock(),
      () => operator.drawNext(),
      () => operator.claimFinalized(),
    ];
    for (const attempt of attempts) {
      await expectFailure(attempt(), "requires the isolated hardhatOp chain");
    }
  });

  it("rejects secret-shaped fields from checkpoints", function () {
    expect(() => assertCheckpointContainsNoSecretFields({ privateKey: "redacted" })).to.throw(
      "forbidden",
    );
    expect(() =>
      assertCheckpointContainsNoSecretFields({ wallets: [{ password: "redacted" }] }),
    ).to.throw("forbidden");
    expect(() =>
      assertCheckpointContainsNoSecretFields({
        wallets: [{ address: "0x0000000000000000000000000000000000000001" }],
      }),
    ).not.to.throw();
    expect(() => assertClosedCheckpointSchema({ unexpected: "field" })).to.throw(
      "is not allowed",
    );
  });

  it("rejects a checkpoint path inside the repository", async function () {
    const store = new JsonCheckpointStore(
      resolve(OPERATOR_WORKSPACE_ROOT, "unsafe.operator-checkpoint.json"),
    );
    await expectFailure(store.save(validCheckpoint()), "outside the workspace");
  });

  it("rejects a non-absolute checkpoint path", async function () {
    const store = new JsonCheckpointStore("relative.operator-checkpoint.json");
    await expectFailure(store.load(), "must be absolute");
  });

  it("rejects a checkpoint path with the wrong extension", async function () {
    const directory = await temporaryDirectory();
    const store = new JsonCheckpointStore(join(directory, "checkpoint.json"));
    await expectFailure(store.load(), "must end with");
  });

  it("rejects a checkpoint path that crosses a symlink or junction", async function () {
    const directory = await temporaryDirectory();
    const actualDirectory = join(directory, "actual");
    const linkedDirectory = join(directory, "linked");
    await mkdir(actualDirectory);
    await symlink(
      actualDirectory,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    const store = new JsonCheckpointStore(
      join(linkedDirectory, "state.operator-checkpoint.json"),
    );
    await expectFailure(store.load(), "symlink");
  });

  it("refuses to overwrite an existing ordinary file", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "state.operator-checkpoint.json");
    await writeFile(filePath, "ordinary file", "utf8");
    const store = new JsonCheckpointStore(filePath);
    await expectFailure(store.save(validCheckpoint()), "not a valid operator checkpoint");
  });

  it("rejects corrupted checkpoint JSON", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "state.operator-checkpoint.json");
    await writeFile(filePath, "{", "utf8");
    const store = new JsonCheckpointStore(filePath);
    await expectFailure(store.load(), "JSON");
  });

  it("writes and reloads a valid checkpoint only outside the workspace", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "new-directory", "state.operator-checkpoint.json");
    const checkpoint = validCheckpoint();
    const store = new JsonCheckpointStore(filePath);
    await store.save(checkpoint);
    expect(await store.load()).to.deep.equal(checkpoint);
    checkpoint.revision = 1;
    checkpoint.updatedAt = "2026-07-15T00:00:01.000Z";
    await store.save(checkpoint);
    expect(await store.load()).to.deep.equal(checkpoint);
  });

  it("rejects a credential URL even in an otherwise allowed field", function () {
    const checkpoint = validCheckpoint();
    checkpoint.updatedAt = "https://user:redacted@example.test";
    expect(() => assertClosedCheckpointSchema(checkpoint)).to.throw("secret-like value");
  });

  it("rejects invalid addresses and chain IDs", function () {
    const invalidAddress = validCheckpoint();
    invalidAddress.tokenAddress = "not-an-address";
    expect(() => assertClosedCheckpointSchema(invalidAddress)).to.throw("valid EVM address");

    const invalidChain = validCheckpoint();
    invalidChain.chainId = "0";
    expect(() => assertClosedCheckpointSchema(invalidChain)).to.throw("outside the allowed range");
  });

  it("rejects malformed transaction hashes", function () {
    const checkpoint = validCheckpoint();
    checkpoint.wallets[0].transactions.push({
      operation: "approved",
      hash: "0x1234",
      blockNumber: 1,
      receiptStatus: 1,
      nonce: 0,
    });
    expect(() => assertClosedCheckpointSchema(checkpoint)).to.throw("32-byte hex hash");
  });

  it("rejects invalid receipt statuses and enum values", function () {
    const invalidReceipt = validCheckpoint();
    invalidReceipt.wallets[0].transactions.push({
      operation: "approved",
      hash: `0x${"11".repeat(32)}`,
      blockNumber: 1,
      receiptStatus: 0,
      nonce: 0,
    });
    expect(() => assertClosedCheckpointSchema(invalidReceipt)).to.throw(
      "receiptStatus must equal 1",
    );

    const invalidStatus = validCheckpoint();
    invalidStatus.poolStatus = "5";
    expect(() => assertClosedCheckpointSchema(invalidStatus)).to.throw("PoolStatus enum");

    const invalidStage = validCheckpoint();
    (invalidStage.wallets[0] as unknown as { stage: string }).stage = "unknown";
    expect(() => assertClosedCheckpointSchema(invalidStage)).to.throw("stage is not allowed");
  });

  it("rejects duplicate wallet addresses and inconsistent indexes", function () {
    const duplicateAddress = validCheckpoint(2);
    duplicateAddress.wallets[1].address = duplicateAddress.wallets[0].address;
    expect(() => assertClosedCheckpointSchema(duplicateAddress)).to.throw("address is duplicated");

    const invalidIndex = validCheckpoint(2);
    invalidIndex.wallets[1].index = 7;
    expect(() => assertClosedCheckpointSchema(invalidIndex)).to.throw(
      "index must match its array position",
    );
  });

  it("reconciles live state before resuming a partially completed join-to-99", async function () {
    const fixture = await networkHelpers.loadFixture(approvedOperatorFixture);
    const checkpointStore = new MemoryCheckpointStore();
    const firstOperator = newOperator(fixture, checkpointStore);
    expect(await firstOperator.joinTo99({ maxTransactions: 10 })).to.equal(10);

    const resumedOperator = newOperator(fixture, checkpointStore);
    const reconciled = await resumedOperator.reconcileCheckpoint();
    expect(reconciled.activePositionCount).to.equal("10");
    expect(reconciled.wallets.filter((wallet) => wallet.activePositionId !== "0")).to.have.length(10);
    expect(await resumedOperator.joinTo99()).to.equal(89);
    expect((await fixture.deployed.pop33.getPool(1)).activePositionCount).to.equal(99n);
  });

  it("rejects resume when a stored transaction hash has no provider provenance", async function () {
    const fixture = await networkHelpers.loadFixture(baseOperatorFixture);
    const checkpointStore = new MemoryCheckpointStore();
    const firstOperator = newOperator(fixture, checkpointStore);
    await firstOperator.preflight();
    const checkpoint = await checkpointStore.load();
    expect(checkpoint).not.to.equal(undefined);
    checkpoint?.wallets[0].transactions.push({
      operation: "approved",
      hash: `0x${"22".repeat(32)}`,
      blockNumber: 1,
      receiptStatus: 1,
      nonce: 0,
    });
    if (checkpoint) await checkpointStore.save(checkpoint);

    const resumedOperator = newOperator(fixture, checkpointStore);
    await expectFailure(resumedOperator.reconcileCheckpoint(), "cannot be confirmed");
  });

  it("hard-stops join-to-99 before the one-hundredth position", async function () {
    const fixture = await networkHelpers.loadFixture(readyAt99Fixture);
    const operator = newOperator(fixture);
    expect(await operator.joinTo99()).to.equal(0);
    const pool = await fixture.deployed.pop33.getPool(1);
    expect(pool.status).to.equal(POOL_STATUS.Open);
    expect(pool.activePositionCount).to.equal(99n);
    const lastWallet = fixture.walletProvider.listWallets()[99];
    expect(await fixture.deployed.pop33.getActivePositionId(1, lastWallet.address)).to.equal(0n);
  });

  it("requires the separate exact confirmation for the one-hundredth join", async function () {
    const fixture = await networkHelpers.loadFixture(readyAt99Fixture);
    const operator = newOperator(fixture);
    await expectFailure(operator.finalJoin("confirm"), "final-join requires exact confirmation");
    expect((await fixture.deployed.pop33.getPool(1)).activePositionCount).to.equal(99n);
    await operator.finalJoin(await operator.finalJoinConfirmation());
    const locked = await fixture.deployed.pop33.getPool(1);
    expect(locked.status).to.equal(POOL_STATUS.Locked);
    expect(locked.activePositionCount).to.equal(100n);
  });

  it("rejects final join at 98/100", async function () {
    const fixture = await networkHelpers.loadFixture(approvedOperatorFixture);
    const operator = newOperator(fixture);
    expect(await operator.joinTo99({ maxTransactions: 98 })).to.equal(98);
    await expectFailure(
      operator.finalJoin(await operator.finalJoinConfirmation()),
      "requires exactly 99 positions",
    );
  });

  it("binds final-join confirmation to the actual chain and pool", async function () {
    const fixture = await networkHelpers.loadFixture(readyAt99Fixture);
    const operator = newOperator(fixture);
    const expected = await operator.finalJoinConfirmation();
    expect(expected).to.equal("CONFIRM FINAL JOIN HARDHAT-OP CHAIN 31337 POOL 1 AT 99/100");
    await expectFailure(
      operator.finalJoin(expected.replace("POOL 1", "POOL 2")),
      "requires exact confirmation",
    );
    expect((await fixture.deployed.pop33.getPool(1)).activePositionCount).to.equal(99n);
  });

  it("detects when the final transaction creates its position in another pool", async function () {
    const fixture = await networkHelpers.loadFixture(readyAt99Fixture);
    const finalWallet = fixture.walletProvider.listWallets()[99];
    const racer = Wallet.createRandom().connect(fixture.deployed.ethers.provider);
    await fixture.deployed.networkHelpers.setBalance(racer.address, parseEther("1"));
    await (await fixture.deployed.token.connect(racer).drip()).wait();
    await (
      await fixture.deployed.token
        .connect(racer)
        .approve(await fixture.deployed.pop33.getAddress(), DEMO_V1_PARAMETERS.entryPrice)
    ).wait();

    const originalPop33 = fixture.deployed.pop33;
    let raced = false;
    const proxiedPop33 = new Proxy(originalPop33, {
      get(target, property) {
        if (property === "connect") {
          return (signer: { address: string }) => {
            const connected = target.connect(signer);
            if (signer.address.toLowerCase() !== finalWallet.address.toLowerCase()) {
              return connected;
            }
            const join = Object.assign(
              async () => connected.join(),
              {
                staticCall: async () => {
                  const simulation = await connected.join.staticCall();
                  if (!raced) {
                    raced = true;
                    await (await target.connect(racer).join()).wait();
                  }
                  return simulation;
                },
              },
            );
            return new Proxy(connected, {
              get(connectedTarget, connectedProperty) {
                if (connectedProperty === "join") return join;
                return Reflect.get(connectedTarget, connectedProperty, connectedTarget);
              },
            });
          };
        }
        return Reflect.get(target, property, target);
      },
    });
    const operator = new DemoV1Operator({
      runtime: { ...fixture.runtime, pop33: proxiedPop33 },
      wallets: fixture.walletProvider,
      checkpointStore: new MemoryCheckpointStore(),
      log: silent,
    });

    await expectFailure(
      operator.finalJoin(await operator.finalJoinConfirmation()),
      "CRITICAL: final join did not create",
    );
    expect(await originalPop33.getActivePositionId(1, finalWallet.address)).to.equal(0n);
    expect(await originalPop33.getActivePositionId(2, finalWallet.address)).not.to.equal(0n);
  });

  it("rejects concurrent write modes before a second transaction can be sent", async function () {
    const fixture = await networkHelpers.loadFixture(approvedOperatorFixture);
    const operator = newOperator(fixture);
    const firstOperation = operator.approve();
    await expectFailure(operator.joinTo99(), "write mode approve is already running");
    await firstOperation;
    expect((await fixture.deployed.pop33.getPool(1)).activePositionCount).to.equal(0n);
  });

  it("does not expose unlocked write implementations at runtime", async function () {
    const fixture = await networkHelpers.loadFixture(baseOperatorFixture);
    const operator = newOperator(fixture);
    const runtimeSurface = operator as unknown as Record<string, unknown>;
    expect(runtimeSurface.joinTo99Unlocked).to.equal(undefined);
    expect(runtimeSurface.finalJoinUnlocked).to.equal(undefined);
    expect(runtimeSurface.claimFinalizedUnlocked).to.equal(undefined);
  });

  it("releases the write lock after an exception", async function () {
    const fixture = await networkHelpers.loadFixture(readyAt99Fixture);
    const operator = newOperator(fixture);
    await expectFailure(operator.finalJoin("wrong"), "requires exact confirmation");
    expect(await operator.joinTo99()).to.equal(0);
  });

  it("stops immediately when a write mode encounters an unexpected pool status", async function () {
    const fixture = await networkHelpers.loadFixture(readyAt99Fixture);
    const operator = newOperator(fixture);
    await operator.finalJoin(await operator.finalJoinConfirmation());
    await expectFailure(operator.joinTo99(), "expected Open");
  });

  it("rejects a draw result whose winner does not own the winning position", async function () {
    const fixture = await networkHelpers.loadFixture(readyAt99Fixture);
    const lockingOperator = newOperator(fixture);
    await lockingOperator.finalJoin(await lockingOperator.finalJoinConfirmation());
    const pendingRound = await fixture.deployed.pop33.getDrawRound(1, 1);
    await fixture.deployed.networkHelpers.time.increaseTo(Number(pendingRound.scheduledAt));

    const originalPop33 = fixture.deployed.pop33;
    const unrelatedAddress = Wallet.createRandom().address;
    const proxiedPop33 = new Proxy(originalPop33, {
      get(target, property) {
        if (property === "getPosition") {
          return async (positionId: bigint) => {
            const position = await target.getPosition(positionId);
            return {
              id: position.id,
              poolId: position.poolId,
              owner: unrelatedAddress,
              joinedAt: position.joinedAt,
              active: position.active,
            };
          };
        }
        return Reflect.get(target, property, target);
      },
    });
    const operator = new DemoV1Operator({
      runtime: { ...fixture.runtime, pop33: proxiedPop33 },
      wallets: fixture.walletProvider,
      checkpointStore: new MemoryCheckpointStore(),
      log: silent,
    });
    await expectFailure(operator.drawNext(), "does not own the active winning position");
  });

  it("runs withdraw, refill, lock, ten unique draws and winner-authorized claims to Finished", async function () {
    const fixture = await networkHelpers.loadFixture(readyAt99Fixture);
    const operator = newOperator(fixture);
    expect(await operator.withdrawAllBeforeLock()).to.equal(99);
    let pool = await fixture.deployed.pop33.getPool(1);
    expect(pool.activePositionCount).to.equal(0n);
    expect(pool.escrowedAmount).to.equal(0n);

    await operator.approve();
    expect(await operator.joinTo99()).to.equal(99);
    await operator.finalJoin(await operator.finalJoinConfirmation());
    pool = await fixture.deployed.pop33.getPool(1);
    expect(pool.status).to.equal(POOL_STATUS.Locked);
    expect(pool.escrowedAmount).to.equal(DEMO_V1_PARAMETERS.totalPrizeAmount);

    const winners = new Set<string>();
    for (let round = 1; round <= 10; round += 1) {
      const pending = await fixture.deployed.pop33.getDrawRound(1, round);
      await fixture.deployed.networkHelpers.time.increaseTo(Number(pending.scheduledAt));
      expect(await operator.drawNext()).to.equal(round);
      const finalized = await fixture.deployed.pop33.getDrawRound(1, round);
      expect(fixture.walletProvider.findWallet(finalized.winner)).not.to.equal(undefined);
      winners.add((finalized.winner as string).toLowerCase());
    }
    expect(winners).to.have.length(10);
    expect(await operator.claimFinalized()).to.equal(10);

    const finished = await fixture.deployed.pop33.getPool(1);
    expect(finished.status).to.equal(POOL_STATUS.Finished);
    expect(finished.activePositionCount).to.equal(0n);
    expect(finished.escrowedAmount).to.equal(0n);
    expect(finished.claimedPrizeAmount).to.equal(DEMO_V1_PARAMETERS.totalPrizeAmount);
    for (let round = 1; round <= 10; round += 1) {
      expect((await fixture.deployed.pop33.getDrawRound(1, round)).claimed).to.equal(true);
    }
    for (const wallet of fixture.walletProvider.listWallets()) {
      expect(await fixture.deployed.pop33.activePositionsByUser(wallet.address)).to.equal(0n);
    }
  });
});
