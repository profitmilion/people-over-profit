import { expect } from "chai";
import { MaxUint256, Wallet, parseEther } from "ethers";
import { network } from "hardhat";

const connection = await network.create();
const { ethers, networkHelpers } = connection;

const ENTRY_PRICE = 33_000_000n;
const MAX_POSITIONS = 100n;
const MAX_ACTIVE = 10n;
const MAX_OPEN_POOLS = 10n;
const DRAW_INTERVAL = 3_600;
const DRAW_ROUNDS = 10n;
const PRIZE_PER_ROUND = 330_000_000n;
const TOTAL_PRIZE_AMOUNT = 3_300_000_000n;

// Hardhat returns dynamic contract and signer shapes until TypeChain is introduced.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicHardhatValue = any;

async function deployFixture() {
  const [deployer, user, secondUser, outsider] = await ethers.getSigners();

  const token = (await ethers.deployContract("MockUSDC")) as DynamicHardhatValue;
  await token.waitForDeployment();

  const pop33 = (await ethers.deployContract("Pop33BasicV1", [
    await token.getAddress(),
    DRAW_INTERVAL,
    MAX_POSITIONS,
  ])) as DynamicHardhatValue;
  await pop33.waitForDeployment();

  return { deployer, user, secondUser, outsider, token, pop33 };
}

async function deployHarnessFixture() {
  const [deployer, user] = await ethers.getSigners();
  const token = (await ethers.deployContract("MockUSDC")) as DynamicHardhatValue;
  await token.waitForDeployment();
  const pop33 = (await ethers.deployContract("Pop33BasicV1Harness", [
    await token.getAddress(),
    DRAW_INTERVAL,
    MAX_POSITIONS,
  ])) as DynamicHardhatValue;
  await pop33.waitForDeployment();
  return { deployer, user, token, pop33 };
}

async function fundAndApprove(
  token: DynamicHardhatValue,
  pop33: DynamicHardhatValue,
  signer: DynamicHardhatValue,
  amount = ENTRY_PRICE,
) {
  await token.mint(signer.address, amount);
  await token.connect(signer).approve(await pop33.getAddress(), MaxUint256);
}

async function createFundedWallet(
  token: DynamicHardhatValue,
  pop33: DynamicHardhatValue,
) {
  const wallet = Wallet.createRandom().connect(ethers.provider);
  await networkHelpers.setBalance(wallet.address, parseEther("1"));
  await fundAndApprove(token, pop33, wallet);
  return wallet;
}

async function createWalletWithoutApproval(
  token: DynamicHardhatValue,
  amount = ENTRY_PRICE,
) {
  const wallet = Wallet.createRandom().connect(ethers.provider);
  await networkHelpers.setBalance(wallet.address, parseEther("1"));
  await token.mint(wallet.address, amount);
  return wallet;
}

async function ninetyNinePositionsFixture() {
  const fixture = await deployFixture();
  const participants: DynamicHardhatValue[] = [];

  for (let index = 0; index < Number(MAX_POSITIONS) - 1; index += 1) {
    const wallet = await createFundedWallet(fixture.token, fixture.pop33);
    participants.push(wallet);
    await fixture.pop33.connect(wallet).join();
  }

  return { ...fixture, participants };
}

async function lockedPoolFixture() {
  const fixture = await ninetyNinePositionsFixture();
  const finalParticipant = await createFundedWallet(fixture.token, fixture.pop33);
  fixture.participants.push(finalParticipant);
  await fixture.pop33.connect(finalParticipant).join();
  return fixture;
}

async function executeAllDrawRounds(fixture: Awaited<ReturnType<typeof lockedPoolFixture>>) {
  const pool = await fixture.pop33.getPool(1);
  for (let roundNumber = 1; roundNumber <= Number(DRAW_ROUNDS); roundNumber += 1) {
    await networkHelpers.time.setNextBlockTimestamp(
      Number(pool.lockedAt) + roundNumber * DRAW_INTERVAL,
    );
    await fixture.pop33.executeDraw(1, roundNumber);
  }
  return fixture;
}

async function claimablePoolFixture() {
  return executeAllDrawRounds(await lockedPoolFixture());
}

async function signerForAddress(
  participants: DynamicHardhatValue[],
  address: string,
) {
  const signer = participants.find(
    (participant) => participant.address.toLowerCase() === address.toLowerCase(),
  );
  expect(signer, `missing participant signer for ${address}`).not.to.equal(undefined);
  return signer as DynamicHardhatValue;
}

async function claimAllPrizes(
  fixture: Awaited<ReturnType<typeof claimablePoolFixture>>,
) {
  for (let roundNumber = 1; roundNumber <= Number(DRAW_ROUNDS); roundNumber += 1) {
    const drawRound = await fixture.pop33.getDrawRound(1, roundNumber);
    const winner = await signerForAddress(fixture.participants, drawRound.winner);
    await fixture.pop33.connect(winner).claim(1, roundNumber);
  }
  return fixture;
}

async function tenActivePositionsFixture() {
  const fixture = await deployFixture();
  await fundAndApprove(
    fixture.token,
    fixture.pop33,
    fixture.user,
    ENTRY_PRICE * MAX_ACTIVE,
  );

  for (let index = 0; index < Number(MAX_ACTIVE); index += 1) {
    await fixture.pop33.connect(fixture.user).join();
  }

  return fixture;
}

describe("MockUSDC", function () {
  it("identifies itself as a non-production six-decimal test token", async function () {
    const { token } = await networkHelpers.loadFixture(deployFixture);

    expect(await token.name()).to.equal("POP33 Test USDC - NOT FOR PRODUCTION");
    expect(await token.symbol()).to.equal("tUSDC");
    expect(await token.decimals()).to.equal(6);
  });

  it("allows unrestricted minting for tests", async function () {
    const { token, user } = await networkHelpers.loadFixture(deployFixture);

    await token.connect(user).mint(user.address, ENTRY_PRICE);
    expect(await token.balanceOf(user.address)).to.equal(ENTRY_PRICE);
  });
});

describe("Pop33BasicV1 deployment and constants", function () {
  it("creates the first open pool automatically", async function () {
    const { pop33 } = await networkHelpers.loadFixture(deployFixture);
    const pool = await pop33.getPool(1);

    expect(await pop33.poolCount()).to.equal(1);
    expect(await pop33.openPoolCount()).to.equal(1);
    expect(await pop33.getOpenPoolIds()).to.deep.equal([1n]);
    expect(pool.id).to.equal(1);
    expect(pool.status).to.equal(0);
    expect(pool.activePositionCount).to.equal(0);
    expect(pool.drawInterval).to.equal(DRAW_INTERVAL);
  });

  it("exposes the approved Basic V1 limits", async function () {
    const { pop33 } = await networkHelpers.loadFixture(deployFixture);

    expect(await pop33.ENTRY_PRICE()).to.equal(ENTRY_PRICE);
    expect(await pop33.MAX_POSITIONS_PER_POOL()).to.equal(MAX_POSITIONS);
    expect(await pop33.MAX_ACTIVE_POSITIONS_PER_USER()).to.equal(MAX_ACTIVE);
    expect(await pop33.MAX_OPEN_POOLS()).to.equal(MAX_OPEN_POOLS);
    expect(await pop33.DRAW_INTERVAL()).to.equal(DRAW_INTERVAL);
    expect(await pop33.DRAW_ROUNDS()).to.equal(DRAW_ROUNDS);
    expect(await pop33.PRIZE_PER_ROUND()).to.equal(PRIZE_PER_ROUND);
    expect(await pop33.TOTAL_PRIZE_AMOUNT()).to.equal(TOTAL_PRIZE_AMOUNT);
  });

  it("snapshots all economic and draw parameters in every pool", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    const originalPool = await pop33.getPool(1);

    expect(originalPool.entryPrice).to.equal(ENTRY_PRICE);
    expect(originalPool.positionsPerPool).to.equal(MAX_POSITIONS);
    expect(originalPool.drawRoundCount).to.equal(DRAW_ROUNDS);
    expect(originalPool.prizePerRound).to.equal(PRIZE_PER_ROUND);
    expect(originalPool.totalPrizeAmount).to.equal(TOTAL_PRIZE_AMOUNT);
    expect(originalPool.drawInterval).to.equal(DRAW_INTERVAL);

    await fundAndApprove(token, pop33, user, ENTRY_PRICE * 2n);
    await pop33.connect(user).join();
    await pop33.connect(user).join();

    const unchangedPool = await pop33.getPool(1);
    const secondPool = await pop33.getPool(2);
    for (const pool of [unchangedPool, secondPool]) {
      expect(pool.entryPrice).to.equal(ENTRY_PRICE);
      expect(pool.positionsPerPool).to.equal(MAX_POSITIONS);
      expect(pool.drawRoundCount).to.equal(DRAW_ROUNDS);
      expect(pool.prizePerRound).to.equal(PRIZE_PER_ROUND);
      expect(pool.totalPrizeAmount).to.equal(TOTAL_PRIZE_AMOUNT);
      expect(pool.drawInterval).to.equal(DRAW_INTERVAL);
    }
  });

  it("rejects a zero payment-token address", async function () {
    const factory = await ethers.getContractFactory("Pop33BasicV1");

    await expect(factory.deploy(ethers.ZeroAddress, DRAW_INTERVAL, MAX_POSITIONS)).to.be.revertedWithCustomError(
      factory,
      "InvalidPaymentToken",
    );
  });

  it("rejects an EOA payment-token address", async function () {
    const [, user] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("Pop33BasicV1");

    await expect(factory.deploy(user.address, DRAW_INTERVAL, MAX_POSITIONS))
      .to.be.revertedWithCustomError(factory, "PaymentTokenHasNoCode")
      .withArgs(user.address);
  });

  it("rejects a contract without ERC-20 metadata", async function () {
    const token = await ethers.deployContract("NonMetadataToken");
    await token.waitForDeployment();
    const factory = await ethers.getContractFactory("Pop33BasicV1");

    await expect(factory.deploy(await token.getAddress(), DRAW_INTERVAL, MAX_POSITIONS))
      .to.be.revertedWithCustomError(factory, "PaymentTokenMetadataUnavailable")
      .withArgs(await token.getAddress());
  });

  it("rejects a token with 18 decimals", async function () {
    const token = await ethers.deployContract("Mock18DecimalToken");
    await token.waitForDeployment();
    const factory = await ethers.getContractFactory("Pop33BasicV1");

    await expect(factory.deploy(await token.getAddress(), DRAW_INTERVAL, MAX_POSITIONS))
      .to.be.revertedWithCustomError(factory, "InvalidPaymentTokenDecimals")
      .withArgs(18);
  });

  it("accepts a standard token with 6 decimals", async function () {
    const { token, pop33 } = await networkHelpers.loadFixture(deployFixture);

    expect(await pop33.paymentToken()).to.equal(await token.getAddress());
  });

  it("rejects a zero draw interval", async function () {
    const { token } = await networkHelpers.loadFixture(deployFixture);
    const factory = await ethers.getContractFactory("Pop33BasicV1");

    await expect(factory.deploy(await token.getAddress(), 0, MAX_POSITIONS)).to.be.revertedWithCustomError(
      factory,
      "InvalidDrawInterval",
    );
  });

  it("rejects a capacity that cannot fund ten equal unique-winner rounds", async function () {
    const { token } = await networkHelpers.loadFixture(deployFixture);
    const factory = await ethers.getContractFactory("Pop33BasicV1");

    for (const invalidCapacity of [0n, 9n, 11n, 101n]) {
      await expect(
        factory.deploy(await token.getAddress(), DRAW_INTERVAL, invalidCapacity),
      )
        .to.be.revertedWithCustomError(factory, "InvalidPositionsPerPool")
        .withArgs(invalidCapacity);
    }
  });
});

describe("Payment", function () {
  it("reverts when the user has no tokens", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await token.connect(user).approve(await pop33.getAddress(), ENTRY_PRICE);

    await expect(pop33.connect(user).join()).to.revert(ethers);
  });

  it("reverts when allowance is missing", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await token.mint(user.address, ENTRY_PRICE);

    await expect(pop33.connect(user).join()).to.revert(ethers);
  });

  it("collects exactly 33,000,000 token units", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);

    await expect(pop33.connect(user).join()).to.changeTokenBalances(
      ethers,
      token,
      [user, pop33],
      [-ENTRY_PRICE, ENTRY_PRICE],
    );
  });

  it("does not collect more when allowance is larger", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await token.mint(user.address, ENTRY_PRICE * 5n);
    await token.connect(user).approve(await pop33.getAddress(), MaxUint256);

    await pop33.connect(user).join();

    expect(await token.balanceOf(await pop33.getAddress())).to.equal(ENTRY_PRICE);
    expect(await token.balanceOf(user.address)).to.equal(ENTRY_PRICE * 4n);
  });

  it("keeps token balance equal to accounted escrow after joins", async function () {
    const { token, pop33, user, secondUser } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);
    await fundAndApprove(token, pop33, secondUser);

    await pop33.connect(user).join();
    await pop33.connect(secondUser).join();

    expect(await pop33.totalEscrowed()).to.equal(ENTRY_PRICE * 2n);
    expect(await token.balanceOf(await pop33.getAddress())).to.equal(
      await pop33.totalEscrowed(),
    );
  });

  it("rolls back a failed join that would have created a new pool", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);
    await pop33.connect(user).join();

    await expect(pop33.connect(user).join()).to.revert(ethers);

    expect(await pop33.poolCount()).to.equal(1);
    expect(await pop33.positionCount()).to.equal(1);
    expect(await pop33.openPoolCount()).to.equal(1);
    expect(await pop33.getOpenPoolIds()).to.deep.equal([1n]);
    expect(await pop33.activePositionsByUser(user.address)).to.equal(1);
    expect((await pop33.queryFilter(pop33.filters.PoolCreated())).length).to.equal(1);
    expect((await pop33.queryFilter(pop33.filters.PositionJoined())).length).to.equal(1);
  });
});

describe("Positions and user limits", function () {
  it("creates a complete first position and emits PositionJoined", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);

    await expect(pop33.connect(user).join())
      .to.emit(pop33, "PositionJoined")
      .withArgs(1, 1, user.address, ENTRY_PRICE, 1);

    const position = await pop33.getPosition(1);
    expect(position.poolId).to.equal(1);
    expect(position.owner).to.equal(user.address);
    expect(position.active).to.equal(true);
    expect(await pop33.getActivePositionId(1, user.address)).to.equal(1);
    expect(await pop33.activePositionsByUser(user.address)).to.equal(1);
  });

  it("never gives one user two active positions in the same pool", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user, ENTRY_PRICE * 2n);

    await pop33.connect(user).join();
    await pop33.connect(user).join();

    expect((await pop33.getPosition(1)).poolId).to.equal(1);
    expect((await pop33.getPosition(2)).poolId).to.equal(2);
    expect(await pop33.hasActivePosition(1, user.address)).to.equal(true);
    expect(await pop33.hasActivePosition(2, user.address)).to.equal(true);
  });

  it("allows exactly ten active positions in different pools", async function () {
    const { pop33, user } = await networkHelpers.loadFixture(tenActivePositionsFixture);

    expect(await pop33.activePositionsByUser(user.address)).to.equal(MAX_ACTIVE);
    expect(await pop33.poolCount()).to.equal(MAX_OPEN_POOLS);
    for (let poolId = 1; poolId <= Number(MAX_OPEN_POOLS); poolId += 1) {
      expect(await pop33.hasActivePosition(poolId, user.address)).to.equal(true);
    }
  });

  it("reverts the eleventh active position", async function () {
    const { pop33, user } = await networkHelpers.loadFixture(tenActivePositionsFixture);

    await expect(pop33.connect(user).join())
      .to.be.revertedWithCustomError(pop33, "MaxActivePositionsReached")
      .withArgs(user.address);
  });

  it("keeps user and pool counters consistent", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user, ENTRY_PRICE * 3n);

    await pop33.connect(user).join();
    await pop33.connect(user).join();
    await pop33.connect(user).join();

    expect(await pop33.activePositionsByUser(user.address)).to.equal(3);
    expect((await pop33.getPool(1)).activePositionCount).to.equal(1);
    expect((await pop33.getPool(2)).activePositionCount).to.equal(1);
    expect((await pop33.getPool(3)).activePositionCount).to.equal(1);
  });
});

describe("Pool allocation", function () {
  it("selects the oldest qualifying open pool", async function () {
    const { token, pop33, user, secondUser } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user, ENTRY_PRICE * 3n);
    await fundAndApprove(token, pop33, secondUser);

    await pop33.connect(user).join();
    await pop33.connect(user).join();
    await pop33.connect(user).join();
    await pop33.connect(secondUser).join();

    expect((await pop33.getPosition(4)).poolId).to.equal(1);
    expect(await pop33.findOldestQualifyingPool(secondUser.address)).to.equal(2);
  });

  it("creates a new pool only when no existing pool qualifies", async function () {
    const { token, pop33, user, secondUser } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user, ENTRY_PRICE * 2n);
    await fundAndApprove(token, pop33, secondUser);

    await pop33.connect(user).join();
    await pop33.connect(secondUser).join();
    expect(await pop33.poolCount()).to.equal(1);

    await pop33.connect(user).join();
    expect(await pop33.poolCount()).to.equal(2);
  });

  it("never has more than ten simultaneously open pools", async function () {
    const { pop33, user } = await networkHelpers.loadFixture(tenActivePositionsFixture);

    expect(await pop33.openPoolCount()).to.equal(MAX_OPEN_POOLS);
    await expect(pop33.connect(user).join()).to.revert(ethers);
    expect(await pop33.openPoolCount()).to.equal(MAX_OPEN_POOLS);
  });

  it("assigns multiple different users to the same oldest open pool", async function () {
    const { token, pop33, user, secondUser, outsider } = await networkHelpers.loadFixture(
      deployFixture,
    );
    for (const signer of [user, secondUser, outsider]) {
      await fundAndApprove(token, pop33, signer);
      await pop33.connect(signer).join();
    }

    expect((await pop33.getPool(1)).activePositionCount).to.equal(3);
    expect(await pop33.poolCount()).to.equal(1);
    expect((await pop33.getPosition(1)).poolId).to.equal(1);
    expect((await pop33.getPosition(2)).poolId).to.equal(1);
    expect((await pop33.getPosition(3)).poolId).to.equal(1);
  });
});

describe("Open-pool index", function () {
  async function tenOpenPoolsHarnessFixture() {
    const fixture = await deployHarnessFixture();
    await fundAndApprove(
      fixture.token,
      fixture.pop33,
      fixture.user,
      ENTRY_PRICE * MAX_OPEN_POOLS,
    );
    for (let index = 0; index < Number(MAX_OPEN_POOLS); index += 1) {
      await fixture.pop33.connect(fixture.user).join();
    }
    return fixture;
  }

  it("removes the only open pool", async function () {
    const { pop33 } = await networkHelpers.loadFixture(deployHarnessFixture);

    await pop33.harnessRemoveOpenPool(1);
    expect(await pop33.getOpenPoolIds()).to.deep.equal([]);
    expect(await pop33.openPoolCount()).to.equal(0);
  });

  it("removes the first pool while preserving order", async function () {
    const { pop33 } = await networkHelpers.loadFixture(tenOpenPoolsHarnessFixture);

    await pop33.harnessRemoveOpenPool(1);
    expect(await pop33.getOpenPoolIds()).to.deep.equal([2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n]);
  });

  it("removes a middle pool while preserving order", async function () {
    const { pop33 } = await networkHelpers.loadFixture(tenOpenPoolsHarnessFixture);

    await pop33.harnessRemoveOpenPool(5);
    expect(await pop33.getOpenPoolIds()).to.deep.equal([1n, 2n, 3n, 4n, 6n, 7n, 8n, 9n, 10n]);
  });

  it("removes the last pool while preserving order", async function () {
    const { pop33 } = await networkHelpers.loadFixture(tenOpenPoolsHarnessFixture);

    await pop33.harnessRemoveOpenPool(10);
    expect(await pop33.getOpenPoolIds()).to.deep.equal([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]);
  });

  it("reverts when removing a pool absent from the index", async function () {
    const { pop33 } = await networkHelpers.loadFixture(deployHarnessFixture);

    await expect(pop33.harnessRemoveOpenPool(2))
      .to.be.revertedWithCustomError(pop33, "OpenPoolNotIndexed")
      .withArgs(2);
  });

  it("keeps count, length, uniqueness, order, and the maximum consistent", async function () {
    const { pop33 } = await networkHelpers.loadFixture(tenOpenPoolsHarnessFixture);
    const ids = await pop33.getOpenPoolIds();

    expect(await pop33.openPoolCount()).to.equal(ids.length);
    expect(ids.length).to.equal(Number(MAX_OPEN_POOLS));
    expect(new Set(ids.map((id: bigint) => id.toString())).size).to.equal(ids.length);
    expect(ids).to.deep.equal([...ids].sort((left: bigint, right: bigint) => Number(left - right)));
  });
});

describe("Bounded active-position set", function () {
  async function threePositionsFixture() {
    const fixture = await deployFixture();
    for (const signer of [fixture.user, fixture.secondUser, fixture.outsider]) {
      await fundAndApprove(fixture.token, fixture.pop33, signer);
      await fixture.pop33.connect(signer).join();
    }
    return fixture;
  }

  it("adds each successful join to the pool's active set", async function () {
    const { pop33 } = await networkHelpers.loadFixture(threePositionsFixture);

    expect(await pop33.getPoolActivePositionCount(1)).to.equal(3);
    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal([1n, 2n, 3n]);
  });

  it("removes the first active position with swap-and-pop", async function () {
    const { pop33, user } = await networkHelpers.loadFixture(threePositionsFixture);

    await pop33.connect(user).withdraw(1);
    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal([3n, 2n]);
  });

  it("removes a middle active position and updates the moved position index", async function () {
    const { pop33, secondUser, outsider } = await networkHelpers.loadFixture(
      threePositionsFixture,
    );

    await pop33.connect(secondUser).withdraw(2);
    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal([1n, 3n]);
    await pop33.connect(outsider).withdraw(3);
    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal([1n]);
  });

  it("removes the last active position without moving another entry", async function () {
    const { pop33, outsider } = await networkHelpers.loadFixture(threePositionsFixture);

    await pop33.connect(outsider).withdraw(3);
    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal([1n, 2n]);
  });

  it("keeps the active set bounded through repeated join-withdraw churn", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);

    for (let round = 1; round <= 40; round += 1) {
      await pop33.connect(user).join();
      expect(await pop33.getPoolActivePositionCount(1)).to.equal(1);
      await pop33.connect(user).withdraw(round);
      expect(await pop33.getPoolActivePositionCount(1)).to.equal(0);
    }

    await pop33.connect(user).join();
    expect(await pop33.positionCount()).to.equal(41);
    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal([41n]);
    expect((await pop33.queryFilter(pop33.filters.PositionJoined())).length).to.equal(41);
    expect((await pop33.queryFilter(pop33.filters.PositionWithdrawn())).length).to.equal(40);
  });

  it("locks with exactly 100 unique active positions owned by different wallets", async function () {
    const { pop33 } = await networkHelpers.loadFixture(lockedPoolFixture);
    const ids = await pop33.getPoolActivePositionIds(1, 0, 100);
    const owners = new Set<string>();

    expect(ids).to.have.length(100);
    expect(new Set(ids.map((id: bigint) => id.toString())).size).to.equal(100);
    for (const positionId of ids) {
      const position = await pop33.getPosition(positionId);
      owners.add(position.owner.toLowerCase());
    }
    expect(owners.size).to.equal(100);
  });
});

describe("Pool capacity and locking", function () {
  it("locks a configured 10-user pilot pool and routes the 11th join to pool 2", async function () {
    const token = (await ethers.deployContract("MockUSDC")) as DynamicHardhatValue;
    await token.waitForDeployment();
    const pilot = (await ethers.deployContract("Pop33BasicV1", [
      await token.getAddress(),
      DRAW_INTERVAL,
      10,
    ])) as DynamicHardhatValue;
    await pilot.waitForDeployment();

    expect(await pilot.MAX_POSITIONS_PER_POOL()).to.equal(10n);
    expect(await pilot.PRIZE_PER_ROUND()).to.equal(ENTRY_PRICE);
    expect(await pilot.TOTAL_PRIZE_AMOUNT()).to.equal(ENTRY_PRICE * 10n);

    for (let index = 0; index < 11; index += 1) {
      const participant = await createFundedWallet(token, pilot);
      await pilot.connect(participant).join();
    }

    const pool1 = await pilot.getPool(1);
    const pool2 = await pilot.getPool(2);
    expect(pool1.status).to.equal(1n);
    expect(pool1.activePositionCount).to.equal(10n);
    expect(pool1.escrowedAmount).to.equal(ENTRY_PRICE * 10n);
    expect(pool2.status).to.equal(0n);
    expect(pool2.activePositionCount).to.equal(1n);
    expect(pool2.escrowedAmount).to.equal(ENTRY_PRICE);
    expect(await pilot.getOpenPoolIds()).to.deep.equal([2n]);
  });

  it("stays Open through 99 positions", async function () {
    const { pop33 } = await networkHelpers.loadFixture(ninetyNinePositionsFixture);
    const pool = await pop33.getPool(1);

    expect(pool.status).to.equal(0);
    expect(pool.activePositionCount).to.equal(99);
    expect((await pop33.getPosition(99)).poolId).to.equal(1);
    expect(await pop33.openPoolCount()).to.equal(1);
  });

  it("locks atomically on the 100th position", async function () {
    const { token, pop33 } = await networkHelpers.loadFixture(ninetyNinePositionsFixture);
    const finalParticipant = await createFundedWallet(token, pop33);

    await expect(pop33.connect(finalParticipant).join()).to.emit(pop33, "PoolLocked");
    const pool = await pop33.getPool(1);

    expect(pool.status).to.equal(1);
    expect(pool.activePositionCount).to.equal(MAX_POSITIONS);
    expect(pool.lockedAt).to.be.greaterThan(0);
    expect(pool.escrowedAmount).to.equal(ENTRY_PRICE * MAX_POSITIONS);
    expect(await pop33.openPoolCount()).to.equal(0);
    expect(await pop33.getOpenPoolIds()).to.deep.equal([]);
    expect(await pop33.getPoolActivePositionCount(1)).to.equal(100);

    const lockEvents = await pop33.queryFilter(pop33.filters.PoolLocked());
    expect(lockEvents).to.have.length(1);
    expect(lockEvents[0].args.poolId).to.equal(1);
    expect(lockEvents[0].args.lockedAt).to.equal(pool.lockedAt);
    expect(lockEvents[0].args.drawInterval).to.equal(DRAW_INTERVAL);
    expect(lockEvents[0].args.activePositionCount).to.equal(100);
    expect(lockEvents[0].args.escrowedAmount).to.equal(ENTRY_PRICE * 100n);
  });

  it("rolls back a failed 100th payment without locking or removing the pool", async function () {
    const { token, pop33 } = await networkHelpers.loadFixture(ninetyNinePositionsFixture);
    const finalParticipant = await createWalletWithoutApproval(token);

    await expect(pop33.connect(finalParticipant).join()).to.revert(ethers);

    const pool = await pop33.getPool(1);
    expect(pool.status).to.equal(0);
    expect(pool.activePositionCount).to.equal(99);
    expect(pool.lockedAt).to.equal(0);
    expect(await pop33.positionCount()).to.equal(99);
    expect(await pop33.getPoolActivePositionCount(1)).to.equal(99);
    expect(await pop33.getOpenPoolIds()).to.deep.equal([1n]);
    expect(await pop33.openPoolCount()).to.equal(1);
    expect((await pop33.queryFilter(pop33.filters.PoolLocked())).length).to.equal(0);
  });

  it("never lets a pool exceed 100 active positions", async function () {
    const { token, pop33, deployer } = await networkHelpers.loadFixture(lockedPoolFixture);
    await fundAndApprove(token, pop33, deployer);

    await pop33.connect(deployer).join();

    expect((await pop33.getPool(1)).activePositionCount).to.equal(MAX_POSITIONS);
    expect((await pop33.getPosition(101)).poolId).to.equal(2);
    expect((await pop33.getPool(2)).activePositionCount).to.equal(1);
  });

  it("routes the next join away from a locked pool", async function () {
    const { token, pop33, deployer } = await networkHelpers.loadFixture(lockedPoolFixture);
    await fundAndApprove(token, pop33, deployer);

    await expect(pop33.connect(deployer).join()).to.emit(pop33, "PoolCreated");
    expect((await pop33.getPosition(101)).poolId).to.equal(2);
  });

  it("does not reduce participant active-position counts when locking", async function () {
    const { pop33, participants } = await networkHelpers.loadFixture(lockedPoolFixture);

    for (const participant of participants.slice(0, 10)) {
      expect(await pop33.activePositionsByUser(participant.address)).to.equal(1);
    }
  });
});

describe("Withdrawal", function () {
  it("allows the owner to withdraw from an Open pool", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);
    await pop33.connect(user).join();

    await expect(pop33.connect(user).withdraw(1))
      .to.emit(pop33, "PositionWithdrawn")
      .withArgs(1, 1, user.address, ENTRY_PRICE, 0);
    expect((await pop33.getPosition(1)).active).to.equal(false);
  });

  it("refunds exactly 33 USDC", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);
    await pop33.connect(user).join();

    await expect(pop33.connect(user).withdraw(1)).to.changeTokenBalances(
      ethers,
      token,
      [pop33, user],
      [-ENTRY_PRICE, ENTRY_PRICE],
    );
  });

  it("decrements all relevant counters and escrow", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);
    await pop33.connect(user).join();
    await pop33.connect(user).withdraw(1);

    expect(await pop33.activePositionsByUser(user.address)).to.equal(0);
    expect((await pop33.getPool(1)).activePositionCount).to.equal(0);
    expect((await pop33.getPool(1)).escrowedAmount).to.equal(0);
    expect(await pop33.totalEscrowed()).to.equal(0);
    expect(await pop33.getActivePositionId(1, user.address)).to.equal(0);
  });

  it("rejects withdrawal by a different wallet", async function () {
    const { token, pop33, user, outsider } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);
    await pop33.connect(user).join();

    await expect(pop33.connect(outsider).withdraw(1))
      .to.be.revertedWithCustomError(pop33, "NotPositionOwner")
      .withArgs(1, outsider.address);
  });

  it("rejects a double withdrawal", async function () {
    const { token, pop33, user } = await networkHelpers.loadFixture(deployFixture);
    await fundAndApprove(token, pop33, user);
    await pop33.connect(user).join();
    await pop33.connect(user).withdraw(1);

    await expect(pop33.connect(user).withdraw(1))
      .to.be.revertedWithCustomError(pop33, "PositionAlreadyInactive")
      .withArgs(1);
  });

  it("rejects withdrawal after Locked", async function () {
    const { pop33, participants } = await networkHelpers.loadFixture(lockedPoolFixture);
    const activeBefore = await pop33.getPoolActivePositionIds(1, 0, 100);

    await expect(pop33.connect(participants[0]).withdraw(1))
      .to.be.revertedWithCustomError(pop33, "PoolNotOpen")
      .withArgs(1);
    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal(activeBefore);
    expect(await pop33.getPoolActivePositionCount(1)).to.equal(100);
  });

  it("allows re-entry to the same open pool with a new unique position ID", async function () {
    const { pop33, user } = await networkHelpers.loadFixture(tenActivePositionsFixture);

    await pop33.connect(user).withdraw(1);
    expect(await pop33.activePositionsByUser(user.address)).to.equal(9);

    await pop33.connect(user).join();
    expect(await pop33.activePositionsByUser(user.address)).to.equal(10);
    expect((await pop33.getPosition(11)).poolId).to.equal(1);
    expect((await pop33.getPosition(1)).active).to.equal(false);
    expect((await pop33.getPosition(11)).active).to.equal(true);
    expect(await pop33.getActivePositionId(1, user.address)).to.equal(11);
    expect(await pop33.getPoolActivePositionCount(1)).to.equal(1);
    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal([11n]);
  });
});

describe("Draw lifecycle", function () {
  it("creates ten numbered rounds with schedules derived from lockedAt", async function () {
    const { pop33 } = await networkHelpers.loadFixture(lockedPoolFixture);
    const pool = await pop33.getPool(1);

    for (let roundNumber = 1; roundNumber <= Number(DRAW_ROUNDS); roundNumber += 1) {
      const drawRound = await pop33.getDrawRound(1, roundNumber);
      expect(drawRound.number).to.equal(roundNumber);
      expect(drawRound.scheduledAt).to.equal(
        pool.lockedAt + BigInt(roundNumber * DRAW_INTERVAL),
      );
      expect(drawRound.status).to.equal(0);
      expect(drawRound.prizeAmount).to.equal(PRIZE_PER_ROUND);
      expect(drawRound.executedAt).to.equal(0);
    }
  });

  it("rejects a draw before its scheduled timestamp", async function () {
    const { pop33 } = await networkHelpers.loadFixture(lockedPoolFixture);
    const drawRound = await pop33.getDrawRound(1, 1);
    await networkHelpers.time.setNextBlockTimestamp(Number(drawRound.scheduledAt) - 1);

    await expect(pop33.executeDraw(1, 1))
      .to.be.revertedWithCustomError(pop33, "DrawRoundNotReady")
      .withArgs(1, 1, drawRound.scheduledAt, drawRound.scheduledAt - 1n);
  });

  it("executes the first draw exactly at the boundary and enters Drawing", async function () {
    const { pop33 } = await networkHelpers.loadFixture(lockedPoolFixture);
    const drawRound = await pop33.getDrawRound(1, 1);
    await networkHelpers.time.setNextBlockTimestamp(Number(drawRound.scheduledAt));

    await expect(pop33.executeDraw(1, 1))
      .to.emit(pop33, "PoolStatusChanged")
      .withArgs(1, 1, 2);

    const pool = await pop33.getPool(1);
    const finalizedRound = await pop33.getDrawRound(1, 1);
    expect(pool.status).to.equal(2);
    expect(pool.completedDrawRoundCount).to.equal(1);
    expect(finalizedRound.status).to.equal(1);
    expect(finalizedRound.executedAt).to.equal(drawRound.scheduledAt);
    expect(finalizedRound.winningPositionId).to.be.greaterThan(0);
    expect(finalizedRound.temporaryRequestId).to.equal(1);
    expect(await pop33.getPoolDrawCandidateCount(1)).to.equal(99);
    expect(await pop33.getPoolActivePositionCount(1)).to.equal(100);
  });

  it("rejects an out-of-sequence round", async function () {
    const { pop33 } = await networkHelpers.loadFixture(lockedPoolFixture);
    const secondRound = await pop33.getDrawRound(1, 2);
    await networkHelpers.time.setNextBlockTimestamp(Number(secondRound.scheduledAt));

    await expect(pop33.executeDraw(1, 2))
      .to.be.revertedWithCustomError(pop33, "DrawRoundOutOfSequence")
      .withArgs(1, 1, 2);
  });

  it("rejects executing the same round twice", async function () {
    const { pop33 } = await networkHelpers.loadFixture(lockedPoolFixture);
    const drawRound = await pop33.getDrawRound(1, 1);
    await networkHelpers.time.setNextBlockTimestamp(Number(drawRound.scheduledAt));
    await pop33.executeDraw(1, 1);

    await expect(pop33.executeDraw(1, 1))
      .to.be.revertedWithCustomError(pop33, "DrawRoundAlreadyExecuted")
      .withArgs(1, 1);
  });

  it("executes exactly ten rounds with ten unique winning positions", async function () {
    const { pop33 } = await networkHelpers.loadFixture(claimablePoolFixture);
    const winningPositionIds = new Set<string>();
    const winningWallets = new Set<string>();

    for (let roundNumber = 1; roundNumber <= Number(DRAW_ROUNDS); roundNumber += 1) {
      const drawRound = await pop33.getDrawRound(1, roundNumber);
      expect(drawRound.number).to.equal(roundNumber);
      expect(drawRound.status).to.equal(1);
      expect(drawRound.prizeAmount).to.equal(PRIZE_PER_ROUND);
      expect(drawRound.claimed).to.equal(false);
      expect(await pop33.isWinningPosition(1, drawRound.winningPositionId)).to.equal(true);
      winningPositionIds.add(drawRound.winningPositionId.toString());
      winningWallets.add(drawRound.winner.toLowerCase());
    }

    const pool = await pop33.getPool(1);
    expect(winningPositionIds.size).to.equal(Number(DRAW_ROUNDS));
    expect(winningWallets.size).to.equal(Number(DRAW_ROUNDS));
    expect(pool.status).to.equal(3);
    expect(pool.completedDrawRoundCount).to.equal(DRAW_ROUNDS);
    expect(pool.assignedPrizeAmount).to.equal(TOTAL_PRIZE_AMOUNT);
    expect(await pop33.totalPrizesAssigned()).to.equal(TOTAL_PRIZE_AMOUNT);
    expect(await pop33.getPoolDrawCandidateCount(1)).to.equal(90);
    expect(await pop33.getPoolActivePositionCount(1)).to.equal(100);
  });

  it("rejects further draws after the pool becomes Claimable", async function () {
    const { pop33 } = await networkHelpers.loadFixture(claimablePoolFixture);

    await expect(pop33.executeDraw(1, 10))
      .to.be.revertedWithCustomError(pop33, "PoolNotDrawable")
      .withArgs(1, 3);
  });
});

describe("Prize claims and Finished", function () {
  it("allows a finalized prize to be claimed while later rounds remain pending", async function () {
    const { token, pop33, participants } = await networkHelpers.loadFixture(lockedPoolFixture);
    const pendingRound = await pop33.getDrawRound(1, 1);
    await networkHelpers.time.setNextBlockTimestamp(Number(pendingRound.scheduledAt));
    await pop33.executeDraw(1, 1);
    const drawRound = await pop33.getDrawRound(1, 1);
    const winner = await signerForAddress(participants, drawRound.winner);

    await expect(pop33.connect(winner).claim(1, 1)).to.changeTokenBalances(
      ethers,
      token,
      [pop33, winner],
      [-PRIZE_PER_ROUND, PRIZE_PER_ROUND],
    );

    const pool = await pop33.getPool(1);
    expect(pool.status).to.equal(2);
    expect(pool.claimedPrizeCount).to.equal(1);
    expect(pool.claimedPrizeAmount).to.equal(PRIZE_PER_ROUND);
    expect(pool.activePositionCount).to.equal(100);
    expect(await pop33.activePositionsByUser(winner.address)).to.equal(1);
  });

  it("rejects a claim by anyone other than the winning position owner", async function () {
    const { pop33, outsider } = await networkHelpers.loadFixture(claimablePoolFixture);
    const drawRound = await pop33.getDrawRound(1, 1);
    expect(drawRound.winner.toLowerCase()).not.to.equal(outsider.address.toLowerCase());

    await expect(pop33.connect(outsider).claim(1, 1))
      .to.be.revertedWithCustomError(pop33, "NotRoundWinner")
      .withArgs(1, 1, outsider.address);
  });

  it("accounts for a successful claim and rejects a double claim", async function () {
    const { token, pop33, participants } = await networkHelpers.loadFixture(
      claimablePoolFixture,
    );
    const drawRound = await pop33.getDrawRound(1, 1);
    const winner = await signerForAddress(participants, drawRound.winner);

    await expect(pop33.connect(winner).claim(1, 1))
      .to.emit(pop33, "PrizeClaimed")
      .withArgs(1, 1, drawRound.winningPositionId, winner.address, PRIZE_PER_ROUND);

    expect((await pop33.getDrawRound(1, 1)).claimed).to.equal(true);
    expect(await pop33.claimablePrizesByUser(winner.address)).to.equal(0);
    expect(await pop33.totalPrizesClaimed()).to.equal(PRIZE_PER_ROUND);
    expect(await pop33.totalEscrowed()).to.equal(TOTAL_PRIZE_AMOUNT - PRIZE_PER_ROUND);
    expect(await token.balanceOf(await pop33.getAddress())).to.equal(
      TOTAL_PRIZE_AMOUNT - PRIZE_PER_ROUND,
    );

    await expect(pop33.connect(winner).claim(1, 1))
      .to.be.revertedWithCustomError(pop33, "PrizeAlreadyClaimed")
      .withArgs(1, 1);
  });

  it("stays Claimable until all ten prizes are claimed", async function () {
    const fixture = await networkHelpers.loadFixture(claimablePoolFixture);

    for (let roundNumber = 1; roundNumber < Number(DRAW_ROUNDS); roundNumber += 1) {
      const drawRound = await fixture.pop33.getDrawRound(1, roundNumber);
      const winner = await signerForAddress(fixture.participants, drawRound.winner);
      await fixture.pop33.connect(winner).claim(1, roundNumber);
    }

    const pool = await fixture.pop33.getPool(1);
    expect(pool.status).to.equal(3);
    expect(pool.claimedPrizeCount).to.equal(9);
    expect(pool.activePositionCount).to.equal(100);
    for (const participant of fixture.participants.slice(0, 10)) {
      expect(await fixture.pop33.activePositionsByUser(participant.address)).to.equal(1);
    }
  });

  it("finishes only after all prizes settle and releases every position", async function () {
    const fixture = await networkHelpers.loadFixture(claimablePoolFixture);
    await claimAllPrizes(fixture);

    const pool = await fixture.pop33.getPool(1);
    expect(pool.status).to.equal(4);
    expect(pool.claimedPrizeCount).to.equal(DRAW_ROUNDS);
    expect(pool.claimedPrizeAmount).to.equal(TOTAL_PRIZE_AMOUNT);
    expect(pool.escrowedAmount).to.equal(0);
    expect(pool.activePositionCount).to.equal(0);
    expect(await fixture.pop33.totalEscrowed()).to.equal(0);
    expect(await fixture.pop33.totalPrizesClaimed()).to.equal(TOTAL_PRIZE_AMOUNT);
    expect(await fixture.pop33.getPoolActivePositionCount(1)).to.equal(0);
    expect(await fixture.pop33.getPoolDrawCandidateCount(1)).to.equal(0);
    expect(await fixture.token.balanceOf(await fixture.pop33.getAddress())).to.equal(0);

    let totalWinnerBalance = 0n;
    for (let roundNumber = 1; roundNumber <= Number(DRAW_ROUNDS); roundNumber += 1) {
      const drawRound = await fixture.pop33.getDrawRound(1, roundNumber);
      expect(drawRound.claimed).to.equal(true);
      totalWinnerBalance += await fixture.token.balanceOf(drawRound.winner);
    }
    expect(totalWinnerBalance).to.equal(TOTAL_PRIZE_AMOUNT);

    for (const participant of fixture.participants) {
      expect(await fixture.pop33.activePositionsByUser(participant.address)).to.equal(0);
    }
    for (let positionId = 1; positionId <= Number(MAX_POSITIONS); positionId += 1) {
      expect((await fixture.pop33.getPosition(positionId)).active).to.equal(false);
    }
  });
});

describe("Getters and invariants", function () {
  it("returns bounded pages of active position IDs", async function () {
    const { token, pop33, user, secondUser, outsider } = await networkHelpers.loadFixture(
      deployFixture,
    );
    for (const signer of [user, secondUser, outsider]) {
      await fundAndApprove(token, pop33, signer);
      await pop33.connect(signer).join();
    }

    expect(await pop33.getPoolActivePositionIds(1, 1, 2)).to.deep.equal([2n, 3n]);
    expect(await pop33.getPoolActivePositionIds(1, 0, 0)).to.deep.equal([]);
    expect(await pop33.getPoolActivePositionIds(1, 3, 100)).to.deep.equal([]);
    expect(await pop33.getPoolActivePositionIds(1, 4, 100)).to.deep.equal([]);
    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal([1n, 2n, 3n]);
    await expect(pop33.getPoolActivePositionIds(1, 0, 101))
      .to.be.revertedWithCustomError(pop33, "PageSizeTooLarge")
      .withArgs(101, 100);
  });

  it("handles an empty pool and rejects a nonexistent pool", async function () {
    const { pop33 } = await networkHelpers.loadFixture(deployFixture);

    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.deep.equal([]);
    await expect(pop33.getPoolActivePositionIds(2, 0, 100))
      .to.be.revertedWithCustomError(pop33, "PoolDoesNotExist")
      .withArgs(2);
  });

  it("returns the full maximum page of 100 locked active positions", async function () {
    const { pop33 } = await networkHelpers.loadFixture(lockedPoolFixture);

    expect(await pop33.getPoolActivePositionIds(1, 0, 100)).to.have.length(100);
  });

  it("keeps contract balance equal to active-position escrow through a mixed sequence", async function () {
    const { token, pop33, user, secondUser, outsider } = await networkHelpers.loadFixture(
      deployFixture,
    );
    await fundAndApprove(token, pop33, user, ENTRY_PRICE * 3n);
    await fundAndApprove(token, pop33, secondUser, ENTRY_PRICE * 2n);
    await fundAndApprove(token, pop33, outsider, ENTRY_PRICE * 2n);

    await pop33.connect(user).join();
    await pop33.connect(user).join();
    await pop33.connect(secondUser).join();
    await pop33.connect(outsider).join();
    await pop33.connect(user).withdraw(1);
    await pop33.connect(outsider).withdraw(4);
    await pop33.connect(secondUser).join();
    await pop33.connect(user).join();

    expect(await pop33.totalEscrowed()).to.equal(ENTRY_PRICE * 4n);
    expect(await token.balanceOf(await pop33.getAddress())).to.equal(
      await pop33.totalEscrowed(),
    );
    expect(await pop33.activePositionsByUser(user.address)).to.equal(2);
    expect(await pop33.activePositionsByUser(secondUser.address)).to.equal(2);
    expect(await pop33.activePositionsByUser(outsider.address)).to.equal(0);
  });

  it("treats direct token donations as surplus without changing escrow", async function () {
    const { token, pop33, user, outsider } = await networkHelpers.loadFixture(deployFixture);
    const donation = 7_000_000n;
    await token.mint(outsider.address, donation);
    await token.connect(outsider).transfer(await pop33.getAddress(), donation);

    expect(await pop33.totalEscrowed()).to.equal(0);
    expect(await token.balanceOf(await pop33.getAddress())).to.equal(donation);

    await fundAndApprove(token, pop33, user);
    await pop33.connect(user).join();
    expect(await pop33.totalEscrowed()).to.equal(ENTRY_PRICE);
    expect(await token.balanceOf(await pop33.getAddress())).to.equal(donation + ENTRY_PRICE);
    expect(await token.balanceOf(await pop33.getAddress())).to.be.at.least(
      await pop33.totalEscrowed(),
    );

    await pop33.connect(user).withdraw(1);
    expect(await pop33.totalEscrowed()).to.equal(0);
    expect(await token.balanceOf(await pop33.getAddress())).to.equal(donation);
  });

  it("preserves all position and pool invariants after a longer join/withdraw sequence", async function () {
    const { token, pop33, user, secondUser, outsider } = await networkHelpers.loadFixture(
      deployFixture,
    );
    const users = [user, secondUser, outsider];
    for (const signer of users) {
      await fundAndApprove(token, pop33, signer, ENTRY_PRICE * 6n);
    }

    for (let round = 0; round < 4; round += 1) {
      for (const signer of users) await pop33.connect(signer).join();
    }
    await pop33.connect(user).withdraw(1);
    await pop33.connect(secondUser).withdraw(2);
    await pop33.connect(user).withdraw(4);
    await pop33.connect(user).join();
    await pop33.connect(secondUser).join();
    await pop33.connect(outsider).withdraw(3);

    const activeSeen = new Set<string>();
    const expectedPerUser = new Map<string, number>();
    const expectedPerPool = new Map<number, number>();
    let expectedActive = 0;

    for (let positionId = 1; positionId <= Number(await pop33.positionCount()); positionId += 1) {
      const position = await pop33.getPosition(positionId);
      if (!position.active) continue;

      const key = `${position.poolId.toString()}:${position.owner.toLowerCase()}`;
      expect(activeSeen.has(key)).to.equal(false);
      activeSeen.add(key);
      expectedActive += 1;
      expectedPerUser.set(
        position.owner,
        (expectedPerUser.get(position.owner) ?? 0) + 1,
      );
      const poolId = Number(position.poolId);
      expectedPerPool.set(poolId, (expectedPerPool.get(poolId) ?? 0) + 1);
    }

    for (const signer of users) {
      const expected = expectedPerUser.get(signer.address) ?? 0;
      expect(await pop33.activePositionsByUser(signer.address)).to.equal(expected);
      expect(expected).to.be.at.most(Number(MAX_ACTIVE));
    }
    for (let poolId = 1; poolId <= Number(await pop33.poolCount()); poolId += 1) {
      const expected = expectedPerPool.get(poolId) ?? 0;
      const pool = await pop33.getPool(poolId);
      expect(pool.activePositionCount).to.equal(expected);
      expect(expected).to.be.at.most(Number(MAX_POSITIONS));
    }

    expect(await pop33.totalEscrowed()).to.equal(ENTRY_PRICE * BigInt(expectedActive));
    expect(await token.balanceOf(await pop33.getAddress())).to.equal(
      ENTRY_PRICE * BigInt(expectedActive),
    );
  });
});
