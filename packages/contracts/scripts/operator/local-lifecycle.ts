import assert from "node:assert/strict";

import { DEMO_V1_PARAMETERS } from "../lib/demo-v1-config.js";
import { createLocalDemoConnection, deployLocalDemoV1 } from "../lib/local-demo.js";
import { MemoryCheckpointStore } from "./checkpoint.js";
import {
  DemoV1Operator,
  POOL_STATUS,
} from "./demo-v1-operator.js";
import { EphemeralLocalWalletProvider } from "./wallet-provider.js";
import { MemoryTransactionJournal } from "./transaction-journal.js";

export async function runFullLocalLifecycle(log = console.log) {
  log("LOCAL OPERATOR TEST ONLY: no external RPC or public blockchain is used.");
  const connection = await createLocalDemoConnection();
  const deployed = await deployLocalDemoV1(connection, false);
  const walletProvider = EphemeralLocalWalletProvider.create(
    Number(DEMO_V1_PARAMETERS.positionsPerPool),
    deployed.ethers.provider,
  );
  const checkpointStore = new MemoryCheckpointStore();
  const transactionJournal = new MemoryTransactionJournal({
    chainId: 31_337n,
    tokenAddress: await deployed.token.getAddress(),
    contractAddress: await deployed.pop33.getAddress(),
  });
  const operator = new DemoV1Operator({
    runtime: {
      network: "hardhatOp",
      provider: deployed.ethers.provider,
      networkHelpers: deployed.networkHelpers,
      token: deployed.token,
      pop33: deployed.pop33,
      drawExecutor: deployed.deployer,
    },
    wallets: walletProvider,
    checkpointStore,
    transactionJournal,
    log,
  });

  const preflight = await operator.preflight();
  assert.equal(preflight.poolStatus, POOL_STATUS.Open);
  assert.equal(preflight.wallets.length, 100);

  await operator.fund();
  await operator.drip();
  await operator.approve();
  assert.equal(await operator.joinTo99(), 99);
  let pool = await deployed.pop33.getPool(1);
  assert.equal(pool.status, POOL_STATUS.Open);
  assert.equal(pool.activePositionCount, 99n);
  assert.equal(pool.escrowedAmount, 99n * DEMO_V1_PARAMETERS.entryPrice);

  assert.equal(await operator.withdrawAllBeforeLock(), 99);
  pool = await deployed.pop33.getPool(1);
  assert.equal(pool.status, POOL_STATUS.Open);
  assert.equal(pool.activePositionCount, 0n);
  assert.equal(pool.escrowedAmount, 0n);

  await operator.approve();
  assert.equal(await operator.joinTo99(), 99);
  await operator.finalJoin(await operator.finalJoinConfirmation());
  pool = await deployed.pop33.getPool(1);
  assert.equal(pool.status, POOL_STATUS.Locked);
  assert.equal(pool.activePositionCount, 100n);
  assert.equal(pool.escrowedAmount, DEMO_V1_PARAMETERS.totalPrizeAmount);

  const winners = new Set<string>();
  for (let round = 1; round <= Number(DEMO_V1_PARAMETERS.drawRoundCount); round += 1) {
    const drawRound = await deployed.pop33.getDrawRound(1, round);
    await deployed.networkHelpers.time.increaseTo(Number(drawRound.scheduledAt));
    assert.equal(await operator.drawNext(), round);
    const finalizedRound = await deployed.pop33.getDrawRound(1, round);
    winners.add((finalizedRound.winner as string).toLowerCase());
  }
  assert.equal(winners.size, 10);
  assert.equal((await deployed.pop33.getPool(1)).status, POOL_STATUS.Claimable);

  assert.equal(await operator.claimFinalized(), 10);
  const finishedPool = await deployed.pop33.getPool(1);
  assert.equal(finishedPool.status, POOL_STATUS.Finished);
  assert.equal(finishedPool.activePositionCount, 0n);
  assert.equal(finishedPool.escrowedAmount, 0n);
  assert.equal(finishedPool.claimedPrizeAmount, DEMO_V1_PARAMETERS.totalPrizeAmount);
  assert.equal(await deployed.pop33.totalEscrowed(), 0n);
  assert.equal(await deployed.token.balanceOf(await deployed.pop33.getAddress()), 0n);
  for (const wallet of walletProvider.listWallets()) {
    assert.equal(await deployed.pop33.activePositionsByUser(wallet.address), 0n);
  }

  const checkpoint = await operator.reconcileCheckpoint();
  assert.equal(checkpoint.poolStatus, POOL_STATUS.Finished.toString());
  assert.equal(checkpoint.activePositionCount, "0");
  assert.equal(checkpoint.escrowedAmount, "0");
  assert.equal(checkpoint.completedDrawRoundCount, "10");
  assert.equal(checkpoint.claimedPrizeCount, "10");

  const journal = transactionJournal.snapshot();
  assert.equal(journal.operations.length, 617);
  assert.equal(
    new Set(journal.operations.map((operation) => operation.operationId)).size,
    journal.operations.length,
  );
  assert.equal(
    journal.operations.every((operation) => operation.status === "confirmed"),
    true,
  );

  log("LOCAL OPERATOR LIFECYCLE PASSED");
  log("  First fill: stopped at 99/100");
  log("  Open-pool withdrawals: 99");
  log("  Second fill: 99/100 plus separately confirmed final join");
  log("  Unique winners: 10");
  log("  Claims: 10");
  log("  Journal: 617 unique operations confirmed");
  log("  Final status: Finished; escrow: 0; active positions: 0");
  return { connection, deployed, operator, walletProvider, checkpoint, journal };
}
