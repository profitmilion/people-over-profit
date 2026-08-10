import { expect } from "chai";

import {
  PILOT_10_CONTRACT_ADDRESS,
  PILOT_10_ENTRY_PRICE,
  PILOT_10_MINIMUM_ETH,
  evaluatePilot10Wallet,
  parsePublicWalletInventory,
  runPilot10WalletInventory,
  validatePilot10InventoryRpcUrl,
  type Pilot10InventoryRuntime,
  type Pilot10WalletSnapshot,
} from "../scripts/operator/pilot-10-wallet-inventory.js";

const ADDRESS_1 = "0xAbA0d03ebDee91c147bB2f0c3591e5f2c042bA9f";
const ADDRESS_2 = "0xE9cA5cA3F9572B0d32573C77517c0E9bf5915F4a";

function snapshot(overrides: Partial<Pilot10WalletSnapshot> = {}): Pilot10WalletSnapshot {
  return {
    nativeBalance: PILOT_10_MINIMUM_ETH,
    tokenBalance: PILOT_10_ENTRY_PRICE,
    allowance: PILOT_10_ENTRY_PRICE,
    activePositionCount: 0n,
    activePositions: [],
    ...overrides,
  };
}

describe("Pilot 10 public wallet inventory", function () {
  it("accepts only labels and public addresses", function () {
    expect(parsePublicWalletInventory({ wallets: [{ label: "Account 2", address: ADDRESS_1 }] }))
      .to.deep.equal([{ label: "Account 2", address: ADDRESS_1 }]);
    expect(() => parsePublicWalletInventory({
      wallets: [{ label: "unsafe", address: ADDRESS_1, privateKey: "not-accepted" }],
    })).to.throw("may contain only: address, label");
  });

  it("rejects invalid addresses, duplicate labels, duplicate addresses and malformed input", function () {
    expect(() => parsePublicWalletInventory({ wallets: [
      { label: "invalid", address: "0x1234" },
    ] })).to.throw("valid public EVM address");
    expect(() => parsePublicWalletInventory({ wallets: [
      { label: "same", address: ADDRESS_1 },
      { label: "same", address: ADDRESS_2 },
    ] })).to.throw("Duplicate wallet label");
    expect(() => parsePublicWalletInventory({ wallets: [
      { label: "one", address: ADDRESS_1 },
      { label: "two", address: ADDRESS_1.toLowerCase() },
    ] })).to.throw("Duplicate wallet address");
    expect(() => parsePublicWalletInventory({ wallets: [] })).to.throw("between 1 and 100");
  });

  it("reports READY and ALREADY_IN_POOL states", function () {
    expect(evaluatePilot10Wallet(snapshot())).to.deep.equal({ state: "READY", issues: [] });
    expect(evaluatePilot10Wallet(snapshot({
      activePositionCount: 1n,
      activePositions: [{ poolId: 2n, positionId: 8n }],
    }))).to.deep.equal({ state: "ALREADY_IN_POOL", issues: [] });
  });

  it("reports NEED_ETH and NEED_DUSDC independently", function () {
    expect(evaluatePilot10Wallet(snapshot({ nativeBalance: PILOT_10_MINIMUM_ETH - 1n })))
      .to.deep.equal({ state: "NEEDS_ACTION", issues: ["NEED_ETH"] });
    expect(evaluatePilot10Wallet(snapshot({ tokenBalance: PILOT_10_ENTRY_PRICE - 1n })))
      .to.deep.equal({ state: "NEEDS_ACTION", issues: ["NEED_DUSDC"] });
  });

  it("reports simultaneous NEED_ETH and NEED_DUSDC without hiding either issue", function () {
    expect(evaluatePilot10Wallet(snapshot({
      nativeBalance: 0n,
      tokenBalance: 0n,
      allowance: 0n,
    }))).to.deep.equal({
      state: "NEEDS_ACTION",
      issues: ["NEED_ETH", "NEED_DUSDC"],
    });
  });

  it("reports NEED_APPROVE only after both asset thresholds are met", function () {
    expect(evaluatePilot10Wallet(snapshot({ allowance: 0n }))).to.deep.equal({
      state: "NEEDS_ACTION",
      issues: ["NEED_APPROVE"],
    });
  });

  it("renders Pool 1, Pool 2 and all active positions without a signer", async function () {
    const runtime: Pilot10InventoryRuntime = {
      async verifyIdentity() {
        return { latestBlock: 123, poolCount: 2n };
      },
      async inspectWallet(address, poolCount) {
        expect(address).to.equal(ADDRESS_1);
        expect(poolCount).to.equal(2n);
        return snapshot({
          activePositionCount: 2n,
          activePositions: [
            { poolId: 1n, positionId: 4n },
            { poolId: 2n, positionId: 9n },
          ],
        });
      },
    };
    const report = await runPilot10WalletInventory(runtime, [{ label: "Account 2", address: ADDRESS_1 }]);
    expect(report.readOnly).to.equal(true);
    expect(report.safety).to.equal("READ_ONLY_NO_SIGNER_NO_BROADCAST");
    expect(report.contractAddress).to.equal(PILOT_10_CONTRACT_ADDRESS);
    expect(report.wallets[0]).to.include({
      hasPositionInPool1: true,
      hasPositionInPool2: true,
      state: "ALREADY_IN_POOL",
    });
    expect(report.wallets[0].issues).to.deep.equal([]);
    expect(report.wallets[0].activePositions).to.deep.equal([
      { poolId: "1", positionId: "4" },
      { poolId: "2", positionId: "9" },
    ]);
  });

  it("accepts only credential-free public HTTPS RPC URLs", function () {
    expect(validatePilot10InventoryRpcUrl("https://sepolia.base.org")).to.equal("https://sepolia.base.org");
    expect(() => validatePilot10InventoryRpcUrl("http://sepolia.base.org")).to.throw("must use HTTPS");
    expect(() => validatePilot10InventoryRpcUrl("https://user:secret@example.com")).to.throw("must not contain credentials");
    expect(() => validatePilot10InventoryRpcUrl("https://localhost:8545")).to.throw("must not point to a local endpoint");
  });
});
