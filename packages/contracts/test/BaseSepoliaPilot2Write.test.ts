import assert from "node:assert/strict";

import {
  PILOT_2_FLOW_CONFIRMATION,
  PILOT_2_NETWORK_CONFIRMATION,
  WalletScopedTransactionJournal,
  assertPilot2Action,
  assertPilot2JournalScope,
  assertPilot2SequentialState,
  assertPilot2WriteAuthorization,
  selectPilot2Addresses,
} from "../scripts/operator/base-sepolia-pilot-2-write.js";
import { MemoryTransactionJournal } from "../scripts/operator/transaction-journal.js";
import {
  BASE_SEPOLIA_SMOKE_CHAIN_ID,
  BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
  BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
} from "../scripts/smoke/base-sepolia-smoke.js";

const ADDRESSES = [
  "0xAF1b71E20c8c5A3eA133b57938da8dc62fE5a9b7",
  "0x44016AaA384A5b52cE0FD86F49cF7Be817D75485",
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
] as const;

function journal() {
  return new MemoryTransactionJournal({
    chainId: BASE_SEPOLIA_SMOKE_CHAIN_ID,
    contractAddress: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
    tokenAddress: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
  });
}

function faucetMeaning(walletAddress: string) {
  return {
    action: "faucet" as const,
    scope: "base-sepolia-smoke-v1:faucet:pool-1",
    walletAddress,
    chainId: BASE_SEPOLIA_SMOKE_CHAIN_ID,
    contractAddress: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
    tokenAddress: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
    poolId: 1n,
    parameters: { dripAmount: 330_000_000n },
  };
}

describe("Base Sepolia guarded two-wallet pilot", function () {
  it("requires the explicit flag and both exact confirmation phrases", function () {
    const env = {
      POP33_PILOT_2_NETWORK_CONFIRM: PILOT_2_NETWORK_CONFIRMATION,
      POP33_PILOT_2_FLOW_CONFIRM: PILOT_2_FLOW_CONFIRMATION,
    };
    assert.throws(() => assertPilot2WriteAuthorization(false, env), /--write-pilot-2/);
    assert.throws(() => assertPilot2WriteAuthorization(true, {
      ...env,
      POP33_PILOT_2_NETWORK_CONFIRM: "yes",
    }), /exact confirmation/);
    assert.throws(() => assertPilot2WriteAuthorization(true, {
      ...env,
      POP33_PILOT_2_FLOW_CONFIRM: "yes",
    }), /exact confirmation/);
    assert.doesNotThrow(() => assertPilot2WriteAuthorization(true, env));
  });

  it("selects exactly wallet indices 0 and 1 from a five-wallet set", function () {
    assert.deepEqual(selectPilot2Addresses(ADDRESSES), ADDRESSES.slice(0, 2));
    assert.throws(() => selectPilot2Addresses(ADDRESSES.slice(0, 2)), /exactly five/);
  });

  it("prohibits draw, claim, deployment and admin actions", function () {
    for (const action of ["draw", "claim", "deploy", "admin"] as const) {
      assert.throws(() => assertPilot2Action(action), /prohibited/);
    }
  });

  it("keeps wallet journals isolated while sharing one durable journal", async function () {
    const store = journal();
    const first = new WalletScopedTransactionJournal(store, ADDRESSES[0], ADDRESSES.slice(0, 2));
    const second = new WalletScopedTransactionJournal(store, ADDRESSES[1], ADDRESSES.slice(0, 2));
    await first.prepare(faucetMeaning(ADDRESSES[0]));
    await second.prepare(faucetMeaning(ADDRESSES[1]));
    assert.equal(store.snapshot().operations.length, 2);
    assert.equal(first.snapshot().operations.length, 1);
    assert.equal(second.snapshot().operations.length, 1);
    assertPilot2JournalScope(store.snapshot(), ADDRESSES.slice(0, 2));
  });

  it("blocks wallet indices 2-4, wrong pool, wrong contract and duplicate actions", async function () {
    const store = journal();
    const first = new WalletScopedTransactionJournal(store, ADDRESSES[0], ADDRESSES.slice(0, 2));
    await assert.rejects(first.prepare(faucetMeaning(ADDRESSES[2])), /another wallet/);
    await assert.rejects(first.prepare({ ...faucetMeaning(ADDRESSES[0]), poolId: 2n }), /pool #1/);
    await assert.rejects(first.prepare({
      ...faucetMeaning(ADDRESSES[0]),
      contractAddress: ADDRESSES[2],
    }), /different contract/);
    await first.prepare(faucetMeaning(ADDRESSES[0]));
    const invalidSnapshot = store.snapshot();
    invalidSnapshot.operations.push(structuredClone(invalidSnapshot.operations[0]));
    assert.throws(() => assertPilot2JournalScope(invalidSnapshot, ADDRESSES.slice(0, 2)), /duplicate/);
  });

  it("blocks wallet 1 before wallet 0 completion and terminal manual-review state", async function () {
    const store = journal();
    const second = new WalletScopedTransactionJournal(store, ADDRESSES[1], ADDRESSES.slice(0, 2));
    const operation = await second.prepare(faucetMeaning(ADDRESSES[1]));
    assert.throws(
      () => assertPilot2SequentialState(store.snapshot(), ADDRESSES.slice(0, 2) as [string, string]),
      /before wallet 0 completed/,
    );
    await store.transition(operation.operationId, "requires_manual_review", { error: "sanitized ambiguity" });
    assert.throws(
      () => assertPilot2SequentialState(store.snapshot(), ADDRESSES.slice(0, 2) as [string, string]),
      /manual recovery review/,
    );
  });
});
