import assert from "node:assert/strict";

import {
  GuardedDrawReadOnlyRpcFailover,
  GuardedDrawRpcFailoverExhaustedError,
  isTransientGuardedDrawRpcError,
} from "../scripts/operator/guarded-draw-rpc-failover.js";

interface MockRpc {
  name: string;
  chainId: bigint;
  bytecode: boolean;
  healthErrors: unknown[];
  readErrors: unknown[];
  value: string;
  reads: number;
}

function rpc(input: Partial<MockRpc> & Pick<MockRpc, "name">): MockRpc {
  return {
    chainId: 84_532n,
    bytecode: true,
    healthErrors: [],
    readErrors: [],
    value: input.name,
    reads: 0,
    ...input,
  };
}

function failover(endpoints: MockRpc[], maxAttemptsPerProvider = 1) {
  return new GuardedDrawReadOnlyRpcFailover({
    endpoints: endpoints.map((client, index) => ({
      name: index === 0 ? "primary" : `fallback-${index}`,
      maskedEndpoint: `${client.name}.example`,
      client,
    })),
    expectedChainId: 84_532n,
    maxAttemptsPerProvider,
    retryDelayMs: 0,
    sleep: async () => undefined,
    async healthCheck(client) {
      const error = client.healthErrors.shift();
      if (error) throw error;
      return {
        chainId: client.chainId,
        contractBytecodePresent: client.bytecode,
      };
    },
  });
}

async function readValue(manager: GuardedDrawReadOnlyRpcFailover<MockRpc>) {
  return manager.read("eth_call", async (client) => {
    client.reads += 1;
    const error = client.readErrors.shift();
    if (error) throw error;
    return client.value;
  });
}

describe("guarded Draw RPC failover", function () {
  it("A. keeps a healthy primary and does not use fallback", async function () {
    const primary = rpc({ name: "primary" });
    const fallback = rpc({ name: "fallback" });
    const manager = failover([primary, fallback]);
    assert.equal(await readValue(manager), "primary");
    assert.equal(primary.reads, 1);
    assert.equal(fallback.reads, 0);
    assert.equal(manager.telemetry().failoverOccurred, false);
    assert.equal(manager.telemetry().providerName, "primary");
  });

  it("B. fails over from a primary HTTP 502 to a healthy fallback", async function () {
    const primary = rpc({
      name: "primary",
      healthErrors: [new Error("HTTP status 502 Bad Gateway")],
    });
    const fallback = rpc({ name: "fallback" });
    const manager = failover([primary, fallback]);
    assert.equal(await readValue(manager), "fallback");
    assert.equal(manager.telemetry().failoverOccurred, true);
    assert.equal(manager.telemetry().providerIndex, 1);
  });

  it("C. fails over from a primary timeout to a healthy fallback", async function () {
    const primary = rpc({
      name: "primary",
      healthErrors: [new Error("The request timed out")],
    });
    const fallback = rpc({ name: "fallback" });
    assert.equal(await readValue(failover([primary, fallback])), "fallback");
  });

  it("D. rejects a wrong-chain endpoint", async function () {
    const primary = rpc({ name: "primary", chainId: 1n });
    const fallback = rpc({ name: "fallback" });
    const manager = failover([primary, fallback]);
    assert.equal(await readValue(manager), "fallback");
    assert.equal(manager.telemetry().providers[0].health, "WRONG_CHAIN");
    assert.equal(manager.telemetry().providers[0].chainId, "1");
  });

  it("E. aborts when all endpoints are unavailable before any signing callback", async function () {
    const primary = rpc({
      name: "primary",
      healthErrors: [new Error("HTTP 503 Service Unavailable")],
    });
    const fallback = rpc({
      name: "fallback",
      healthErrors: [new Error("connection reset")],
    });
    let signingStarted = false;
    const manager = failover([primary, fallback]);
    const preflightThenSign = async () => {
      await readValue(manager);
      signingStarted = true;
    };
    await assert.rejects(
      preflightThenSign,
      GuardedDrawRpcFailoverExhaustedError,
    );
    assert.equal(signingStarted, false);
    assert.equal(primary.reads, 0);
    assert.equal(fallback.reads, 0);
  });

  it("F. uses fallback only for receipt lookup after a known hash", async function () {
    const primary = rpc({
      name: "primary",
      readErrors: [new Error("HTTP 502 during receipt lookup")],
    });
    const fallback = rpc({ name: "fallback", value: "success receipt" });
    const manager = failover([primary, fallback]);
    let broadcasts = 0;
    const broadcastOnce = () => {
      broadcasts += 1;
      return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    };
    const transactionHash = broadcastOnce();
    assert.ok(transactionHash);
    assert.equal(await readValue(manager), "success receipt");
    assert.equal(broadcasts, 1);
    assert.equal(manager.telemetry().failoverOccurred, true);
  });

  it("G. does not fail over on contract revert or logical error", async function () {
    const primary = rpc({
      name: "primary",
      readErrors: [new Error("ContractFunctionRevertedError: execution reverted")],
    });
    const fallback = rpc({ name: "fallback" });
    const manager = failover([primary, fallback]);
    await assert.rejects(() => readValue(manager), /execution reverted/);
    assert.equal(primary.reads, 1);
    assert.equal(fallback.reads, 0);
    assert.equal(manager.telemetry().failoverOccurred, false);
  });

  it("classifies only transient infrastructure failures as failover-safe", function () {
    assert.equal(isTransientGuardedDrawRpcError(new Error("HTTP 502")), true);
    assert.equal(isTransientGuardedDrawRpcError(new Error("request timeout")), true);
    assert.equal(
      isTransientGuardedDrawRpcError(new Error("execution reverted: DrawRoundNotReady")),
      false,
    );
  });

  it("reports a bounded read-only retry without unnecessary failover", async function () {
    const primary = rpc({
      name: "primary",
      readErrors: [new Error("request timeout")],
    });
    const fallback = rpc({ name: "fallback" });
    const manager = failover([primary, fallback], 2);
    assert.equal(await readValue(manager), "primary");
    assert.equal(primary.reads, 2);
    assert.equal(fallback.reads, 0);
    assert.equal(manager.telemetry().readOnlyRetries, 1);
    assert.equal(manager.telemetry().providerIndex, 0);
    assert.equal(manager.telemetry().failoverOccurred, false);
  });
});
