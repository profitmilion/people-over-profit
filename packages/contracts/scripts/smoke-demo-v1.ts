import assert from "node:assert/strict";

import { type HDNodeWallet, MaxUint256, parseEther, Wallet } from "ethers";

import { DEMO_V1_PARAMETERS } from "./lib/demo-v1-config.js";
import { createLocalDemoConnection, deployLocalDemoV1 } from "./lib/local-demo.js";

console.log("LOCAL SMOKE TEST ONLY: no external RPC or public blockchain is used.");
const connection = await createLocalDemoConnection();
const { ethers, networkHelpers, token, pop33 } = await deployLocalDemoV1(
  connection,
  false,
);

const participants: HDNodeWallet[] = [];
const participantByAddress = new Map<string, HDNodeWallet>();

for (let index = 0; index < Number(DEMO_V1_PARAMETERS.positionsPerPool); index += 1) {
  const participant = Wallet.createRandom().connect(ethers.provider);
  participants.push(participant);
  participantByAddress.set(participant.address.toLowerCase(), participant);

  await networkHelpers.setBalance(participant.address, parseEther("1"));
  await (await token.connect(participant).drip()).wait();
  assert.equal(
    await token.balanceOf(participant.address),
    DEMO_V1_PARAMETERS.dripAmount,
    "Each participant must receive exactly one faucet drip.",
  );
  await (
    await token
      .connect(participant)
      .approve(await pop33.getAddress(), MaxUint256)
  ).wait();
  await (await pop33.connect(participant).join()).wait();
}

const lockedPool = await pop33.getPool(1);
assert.equal(lockedPool.status, 1n, "Pool must be Locked after 100 positions.");
assert.equal(
  lockedPool.escrowedAmount,
  DEMO_V1_PARAMETERS.totalPrizeAmount,
  "Locked escrow must equal the total prize amount.",
);

const winningPositionIds = new Set<string>();
for (let roundNumber = 1; roundNumber <= Number(DEMO_V1_PARAMETERS.drawRoundCount); roundNumber += 1) {
  await networkHelpers.time.setNextBlockTimestamp(
    Number(lockedPool.lockedAt) +
      roundNumber * Number(DEMO_V1_PARAMETERS.drawIntervalSeconds),
  );
  await (await pop33.executeDraw(1, roundNumber)).wait();

  const drawRound = await pop33.getDrawRound(1, roundNumber);
  assert.equal(drawRound.status, 1n, `Round ${roundNumber} must be finalized.`);
  winningPositionIds.add(drawRound.winningPositionId.toString());
}

assert.equal(
  winningPositionIds.size,
  Number(DEMO_V1_PARAMETERS.drawRoundCount),
  "All winning positions must be unique.",
);
assert.equal((await pop33.getPool(1)).status, 3n, "Pool must be Claimable.");

for (let roundNumber = 1; roundNumber <= Number(DEMO_V1_PARAMETERS.drawRoundCount); roundNumber += 1) {
  const drawRound = await pop33.getDrawRound(1, roundNumber);
  const winner = participantByAddress.get(drawRound.winner.toLowerCase());
  assert.ok(winner, `Missing local signer for round ${roundNumber} winner.`);
  await (await pop33.connect(winner).claim(1, roundNumber)).wait();
  assert.equal(
    await token.balanceOf(winner.address),
    DEMO_V1_PARAMETERS.dripAmount - DEMO_V1_PARAMETERS.entryPrice +
      DEMO_V1_PARAMETERS.prizePerRound,
    `Round ${roundNumber} winner balance must include one prize.`,
  );
}

const finishedPool = await pop33.getPool(1);
assert.equal(finishedPool.status, 4n, "Pool must be Finished after all claims.");
assert.equal(finishedPool.escrowedAmount, 0n);
assert.equal(finishedPool.claimedPrizeAmount, DEMO_V1_PARAMETERS.totalPrizeAmount);
assert.equal(await pop33.totalEscrowed(), 0n);
assert.equal(await pop33.totalPrizesAssigned(), DEMO_V1_PARAMETERS.totalPrizeAmount);
assert.equal(await pop33.totalPrizesClaimed(), DEMO_V1_PARAMETERS.totalPrizeAmount);
assert.equal(await token.balanceOf(await pop33.getAddress()), 0n);

let totalParticipantBalance = 0n;
for (const participant of participants) {
  totalParticipantBalance += await token.balanceOf(participant.address);
}
assert.equal(
  totalParticipantBalance,
  DEMO_V1_PARAMETERS.dripAmount * DEMO_V1_PARAMETERS.positionsPerPool,
  "All faucet issuance must remain accounted for after entries and prizes.",
);
assert.equal(totalParticipantBalance, await token.totalSupply());

for (const participant of participants) {
  assert.equal(await pop33.activePositionsByUser(participant.address), 0n);
}

console.log("LOCAL DEMO V1 SMOKE TEST PASSED");
console.log("  Positions: 100");
console.log("  Faucet drips: 100 x 330 dUSDC");
console.log("  Unique winners: 10");
console.log("  Claims: 10");
console.log("  Final status: Finished");
console.log("  Remaining accounted escrow: 0");
