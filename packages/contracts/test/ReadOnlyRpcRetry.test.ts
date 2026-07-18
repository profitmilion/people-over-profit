import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isReadOnlyRpcRateLimitError,
  withReadOnlyRpcRetry,
} from "../scripts/operator/read-only-rpc-retry.js";

interface CodedError extends Error {
  code?: number | string;
  response?: { status: number };
}

function codedError(message: string, code?: number | string): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}

const deterministicOptions = {
  sleep: async () => undefined,
  random: () => 0.5,
  log: () => undefined,
};

describe("read-only RPC bounded retry", function () {
  it("returns a successful read without retry", async function () {
    let calls = 0;
    const delays: number[] = [];
    const result = await withReadOnlyRpcRetry("test read", async () => {
      calls += 1;
      return "ok";
    }, {
      ...deterministicOptions,
      sleep: async (delayMs) => { delays.push(delayMs); },
    });
    assert.equal(result, "ok");
    assert.equal(calls, 1);
    assert.deepEqual(delays, []);
  });

  it("retries JSON-RPC -32016 once and then succeeds", async function () {
    let calls = 0;
    const delays: number[] = [];
    const result = await withReadOnlyRpcRetry("pending nonce", async () => {
      calls += 1;
      if (calls === 1) throw codedError("over rate limit", -32_016);
      return 7;
    }, {
      ...deterministicOptions,
      sleep: async (delayMs) => { delays.push(delayMs); },
    });
    assert.equal(result, 7);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [500]);
  });

  it("retries several unequivocal rate limits and then succeeds", async function () {
    let calls = 0;
    const delays: number[] = [];
    const errors: unknown[] = [
      codedError("request rate limit exceeded"),
      { message: "Too Many Requests", response: { status: 429 } },
      codedError("provider limit exceeded", -32_005),
    ];
    const result = await withReadOnlyRpcRetry("wallet reads", async () => {
      const error = errors[calls];
      calls += 1;
      if (error) throw error;
      return "complete";
    }, {
      ...deterministicOptions,
      sleep: async (delayMs) => { delays.push(delayMs); },
    });
    assert.equal(result, "complete");
    assert.equal(calls, 4);
    assert.deepEqual(delays, [500, 1_000, 2_000]);
  });

  it("hard-stops after the bounded attempt limit", async function () {
    let calls = 0;
    const delays: number[] = [];
    await assert.rejects(withReadOnlyRpcRetry("pending nonce", async () => {
      calls += 1;
      throw codedError("over rate limit", -32_016);
    }, {
      ...deterministicOptions,
      maxAttempts: 3,
      sleep: async (delayMs) => { delays.push(delayMs); },
    }), /remained rate-limited after 3 attempts/);
    assert.equal(calls, 3);
    assert.deepEqual(delays, [500, 1_000]);
  });

  it("does not retry wrong-password, artifact, or contract errors", async function () {
    for (const failure of [
      codedError("Unable to decrypt wallet store: wrong password or file integrity failure."),
      codedError("Operator set store ID mismatch."),
      codedError("execution reverted", "CALL_EXCEPTION"),
    ]) {
      let calls = 0;
      await assert.rejects(withReadOnlyRpcRetry("non-transient read", async () => {
        calls += 1;
        throw failure;
      }, deterministicOptions), (error) => error === failure);
      assert.equal(calls, 1);
    }
  });

  it("recognizes nested HTTP 429 and redacts secrets from retry logs and final errors", async function () {
    assert.equal(isReadOnlyRpcRateLimitError({ response: { status: 429 } }), true);
    const nonEnumerableStatus = new Error("provider request failed");
    Object.defineProperty(nonEnumerableStatus, "status", { value: 429, enumerable: false });
    assert.equal(isReadOnlyRpcRateLimitError(nonEnumerableStatus), true);
    const secret = `0x${"a".repeat(64)}`;
    const logs: string[] = [];
    let finalMessage = "";
    try {
      await withReadOnlyRpcRetry("safe label", async () => {
        throw codedError(`over rate limit password=hunter2 key=${secret} https://user:pass@example.test/rpc`);
      }, {
        ...deterministicOptions,
        maxAttempts: 2,
        log: (message) => { logs.push(message); },
      });
    } catch (error) {
      finalMessage = (error as Error).message;
    }
    const output = [...logs, finalMessage].join("\n");
    assert.doesNotMatch(output, /hunter2|user:pass|a{64}/i);
    assert.match(output, /\[redacted/);
  });

  it("contains no signing, broadcast, write, or lifecycle execution primitive", async function () {
    const source = await readFile(
      new URL("../scripts/operator/read-only-rpc-retry.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /sendTransaction|sendRawTransaction|eth_sendTransaction|writeContract|walletClient|\bSigner\b|privateKey|faucet\(|approve\(|join\(|withdraw\(|executeDraw\(|claim\(/i,
    );
  });
});
