import { expect } from "chai";
import { MaxUint256 } from "ethers";
import { network } from "hardhat";

const connection = await network.create();
const { ethers, networkHelpers } = connection;

const DRIP_AMOUNT = 330_000_000n;
const DRIP_COOLDOWN = 86_400n;
const ENTRY_PRICE = 33_000_000n;
const DRAW_INTERVAL = 3_600;

// Hardhat contract shapes remain dynamic until TypeChain becomes a tracked artifact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicHardhatValue = any;

async function deployDemoTokenFixture() {
  const [deployer, user, secondUser] = await ethers.getSigners();
  const token = (await ethers.deployContract("Pop33DemoUSDC", [
    DRIP_AMOUNT,
    DRIP_COOLDOWN,
  ])) as DynamicHardhatValue;
  await token.waitForDeployment();
  return { deployer, user, secondUser, token };
}

describe("Pop33DemoUSDC deployment", function () {
  it("uses an unambiguous non-Circle demo identity and six decimals", async function () {
    const { token } = await networkHelpers.loadFixture(deployDemoTokenFixture);

    expect(await token.name()).to.equal("POP33 Demo USD");
    expect(await token.symbol()).to.equal("dUSDC");
    expect(await token.decimals()).to.equal(6);
    expect(await token.DRIP_AMOUNT()).to.equal(DRIP_AMOUNT);
    expect(await token.DRIP_COOLDOWN()).to.equal(DRIP_COOLDOWN);
  });

  it("rejects zero drip amount and zero cooldown", async function () {
    const factory = await ethers.getContractFactory("Pop33DemoUSDC");

    await expect(factory.deploy(0, DRIP_COOLDOWN)).to.be.revertedWithCustomError(
      factory,
      "InvalidDripAmount",
    );
    await expect(factory.deploy(DRIP_AMOUNT, 0)).to.be.revertedWithCustomError(
      factory,
      "InvalidDripCooldown",
    );
  });

  it("has no owner, administrative mint, sale, or payable faucet interface", async function () {
    const { token } = await networkHelpers.loadFixture(deployDemoTokenFixture);

    expect(token.interface.hasFunction("owner")).to.equal(false);
    expect(token.interface.hasFunction("mint")).to.equal(false);
    expect(token.interface.hasFunction("buy")).to.equal(false);
    expect(token.interface.getFunction("drip").payable).to.equal(false);
    expect(await ethers.provider.getBalance(await token.getAddress())).to.equal(0);
  });
});

describe("Pop33DemoUSDC faucet", function () {
  it("drips exactly 330 dUSDC to msg.sender and emits the schedule", async function () {
    const { token, user } = await networkHelpers.loadFixture(deployDemoTokenFixture);
    const nextBlockTimestamp = (await networkHelpers.time.latest()) + 10;
    await networkHelpers.time.setNextBlockTimestamp(nextBlockTimestamp);

    await expect(token.connect(user).drip())
      .to.emit(token, "DemoTokensDripped")
      .withArgs(user.address, DRIP_AMOUNT, BigInt(nextBlockTimestamp) + DRIP_COOLDOWN);

    expect(await token.balanceOf(user.address)).to.equal(DRIP_AMOUNT);
    expect(await token.totalSupply()).to.equal(DRIP_AMOUNT);
    expect(await token.nextDripAt(user.address)).to.equal(
      BigInt(nextBlockTimestamp) + DRIP_COOLDOWN,
    );
  });

  it("rejects a second drip before cooldown", async function () {
    const { token, user } = await networkHelpers.loadFixture(deployDemoTokenFixture);
    await token.connect(user).drip();
    const nextAvailableAt = await token.nextDripAt(user.address);

    await expect(token.connect(user).drip())
      .to.be.revertedWithCustomError(token, "DripCooldownActive")
      .withArgs(user.address, nextAvailableAt);
  });

  it("allows the next drip exactly at the cooldown boundary", async function () {
    const { token, user } = await networkHelpers.loadFixture(deployDemoTokenFixture);
    await token.connect(user).drip();
    const nextAvailableAt = await token.nextDripAt(user.address);
    await networkHelpers.time.setNextBlockTimestamp(Number(nextAvailableAt));

    await token.connect(user).drip();

    expect(await token.balanceOf(user.address)).to.equal(DRIP_AMOUNT * 2n);
    expect(await token.nextDripAt(user.address)).to.equal(
      nextAvailableAt + DRIP_COOLDOWN,
    );
  });

  it("tracks cooldown independently for each address", async function () {
    const { token, user, secondUser } = await networkHelpers.loadFixture(
      deployDemoTokenFixture,
    );
    await token.connect(user).drip();

    expect(await token.nextDripAt(secondUser.address)).to.equal(0);
    await token.connect(secondUser).drip();
    expect(await token.balanceOf(user.address)).to.equal(DRIP_AMOUNT);
    expect(await token.balanceOf(secondUser.address)).to.equal(DRIP_AMOUNT);
  });

  it("mints only its own valueless demo units and never transfers native assets", async function () {
    const { token, user } = await networkHelpers.loadFixture(deployDemoTokenFixture);
    const tokenNativeBalanceBefore = await ethers.provider.getBalance(
      await token.getAddress(),
    );

    await token.connect(user).drip();

    expect(await ethers.provider.getBalance(await token.getAddress())).to.equal(
      tokenNativeBalanceBefore,
    );
    expect(await token.totalSupply()).to.equal(DRIP_AMOUNT);
  });
});

describe("Pop33DemoUSDC compatibility", function () {
  it("is accepted by Pop33BasicV1 and funds a paid position through drip", async function () {
    const { token, user } = await networkHelpers.loadFixture(deployDemoTokenFixture);
    const pop33 = (await ethers.deployContract("Pop33BasicV1", [
      await token.getAddress(),
      DRAW_INTERVAL,
      100,
    ])) as DynamicHardhatValue;
    await pop33.waitForDeployment();

    await token.connect(user).drip();
    await token.connect(user).approve(await pop33.getAddress(), MaxUint256);
    await pop33.connect(user).join();

    expect(await pop33.paymentToken()).to.equal(await token.getAddress());
    expect(await token.balanceOf(await pop33.getAddress())).to.equal(ENTRY_PRICE);
    expect((await pop33.getPosition(1)).owner).to.equal(user.address);
    expect(await token.balanceOf(user.address)).to.equal(DRIP_AMOUNT - ENTRY_PRICE);
  });
});
