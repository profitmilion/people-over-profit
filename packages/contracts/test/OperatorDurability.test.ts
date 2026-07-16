import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "chai";
import { Wallet, type Provider } from "ethers";

import {
  EncryptedWalletProvider,
  validateWalletRecords,
} from "../scripts/operator/encrypted-wallet-store.js";
import { openDurableOperatorState } from "../scripts/operator/durable-operator-state.js";
import { assertExecutionPolicy } from "../scripts/operator/network-policy.js";
import { withExclusiveFileLock } from "../scripts/operator/durable-file.js";
import {
  JsonTransactionJournal,
  MemoryTransactionJournal,
  operationIdFor,
  sanitizeOperatorError,
} from "../scripts/operator/transaction-journal.js";
import {
  executeJournaledOperation,
  recoverJournalOperation,
  type RecoveryReceipt,
  type RecoveryTransaction,
  type TransactionRecoveryProvider,
} from "../scripts/operator/transaction-recovery.js";

const PASSWORD = ["correct", "horse", "battery", "staple"].join("-");
const OTHER_PASSWORD = ["another", "long", "runtime", "password"].join("-");
const CONTRACT = "0x1000000000000000000000000000000000000001";
const TOKEN = "0x2000000000000000000000000000000000000002";
const PARTICIPANT = "0x3000000000000000000000000000000000000003";
const HASH_A = `0x${"11".repeat(32)}`;
const HASH_B = `0x${"22".repeat(32)}`;
const identity = { chainId: 31_337n, contractAddress: CONTRACT, tokenAddress: TOKEN };
const meaning = {
  action: "join" as const,
  scope: "wallet-0-position-1",
  walletAddress: PARTICIPANT,
  chainId: 31_337n,
  contractAddress: CONTRACT,
  tokenAddress: TOKEN,
  poolId: 1n,
  parameters: { expectedPoolId: 1n, expectedCount: 0n },
};

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-operator-durability-"));
  directories.push(directory);
  return directory;
}

async function expectFailure(promise: Promise<unknown>, text: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect((error as Error).message).to.include(text);
    return;
  }
  expect.fail(`Expected failure containing: ${text}`);
}

function successfulReceipt(hash = HASH_A): RecoveryReceipt {
  return { hash, blockNumber: 42, status: 1, gasUsed: 21_000n };
}

function successfulTransaction(hash = HASH_A, nonce = 7): RecoveryTransaction {
  return { hash, from: PARTICIPANT, to: CONTRACT, nonce, data: "0x1234", value: 0n };
}

function response(hash = HASH_A, nonce = 7, receipt = successfulReceipt(hash)) {
  return { hash, nonce, wait: async () => receipt };
}

class FakeRecoveryProvider implements TransactionRecoveryProvider {
  transaction: RecoveryTransaction | null = null;
  receipt: RecoveryReceipt | null = null;
  replacement: RecoveryTransaction | null = null;
  latestNonce = 7;
  pendingNonce = 7;

  async getTransaction(): Promise<RecoveryTransaction | null> { return this.transaction; }
  async getTransactionReceipt(): Promise<RecoveryReceipt | null> { return this.receipt; }
  async getTransactionCount(_address: string, tag: "latest" | "pending"): Promise<number> {
    return tag === "latest" ? this.latestNonce : this.pendingNonce;
  }
  async findTransactionBySenderAndNonce(): Promise<RecoveryTransaction | null> {
    return this.replacement;
  }
}

async function pendingOperation(journal: MemoryTransactionJournal) {
  let operation = await journal.prepare(meaning);
  operation = await journal.transition(operation.operationId, "ready_to_broadcast", { nonce: 7 });
  operation = await journal.transition(operation.operationId, "broadcast", { transactionHash: HASH_A });
  return journal.transition(operation.operationId, "pending");
}

describe("Operator encrypted wallet store", function () {
  this.timeout(30_000);

  afterEach(async function () {
    while (directories.length) {
      const directory = directories.pop();
      if (directory?.startsWith(tmpdir())) await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates once and reopens exactly the same encrypted wallets", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "wallets.operator-wallets.enc.json");
    const first = await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 4, provider: null as unknown as Provider,
    });
    const addresses = first.listWallets().map((wallet) => wallet.address);
    const second = await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 4, provider: null as unknown as Provider,
    });
    expect(second.supportsProcessRestart).to.equal(true);
    expect(second.listWallets().map((wallet) => wallet.address)).to.deep.equal(addresses);

    const cleartext = await readFile(filePath, "utf8");
    expect(cleartext).not.to.match(/privateKey|mnemonic|seed phrase/i);
    for (const wallet of first.listWallets()) {
      expect(cleartext).not.to.include(wallet.address);
      expect(cleartext).not.to.include(wallet.privateKey);
    }
  });

  it("opens wallet and journal paths from environment while reading the password only at runtime", async function () {
    const directory = await temporaryDirectory();
    let prompts = 0;
    const state = await openDurableOperatorState({
      env: {
        OPERATOR_WALLET_STORE_PATH: join(directory, "wallets.operator-wallets.enc.json"),
        OPERATOR_TRANSACTION_JOURNAL_PATH: join(directory, "transactions.operator-journal.json"),
      },
      passwordReader: {
        readPassword: async () => { prompts += 1; return PASSWORD; },
      },
      walletCount: 2,
      provider: null as unknown as Provider,
      journalIdentity: identity,
    });
    expect(prompts).to.equal(1);
    expect(state.wallets.listWallets()).to.have.length(2);
    expect(state.journal.snapshot().operations).to.have.length(0);
  });

  it("rejects a wrong password without exposing password, key, or ciphertext", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "wallets.operator-wallets.enc.json");
    const provider = await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 1, provider: null as unknown as Provider,
    });
    const privateKey = provider.listWallets()[0].privateKey;
    try {
      await EncryptedWalletProvider.openOrCreate({
        filePath, password: OTHER_PASSWORD, walletCount: 1, provider: null as unknown as Provider,
      });
      expect.fail("Wrong password should fail.");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).to.include("wrong password or file integrity failure");
      expect(message).not.to.include(PASSWORD);
      expect(message).not.to.include(OTHER_PASSWORD);
      expect(message).not.to.include(privateKey);
    }
  });

  it("detects tampering, truncation, and an unsupported format version", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "wallets.operator-wallets.enc.json");
    await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider,
    });
    const original = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    const ciphertext = original.ciphertext as string;
    original.ciphertext = `${ciphertext.slice(0, -2)}AA`;
    await writeFile(filePath, JSON.stringify(original), "utf8");
    await expectFailure(
      EncryptedWalletProvider.openOrCreate({ filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider }),
      "file integrity failure",
    );

    await writeFile(filePath, "{", "utf8");
    await expectFailure(
      EncryptedWalletProvider.openOrCreate({ filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider }),
      "incomplete or invalid JSON",
    );

    original.formatVersion = 2;
    await writeFile(filePath, JSON.stringify(original), "utf8");
    await expectFailure(
      EncryptedWalletProvider.openOrCreate({ filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider }),
      "Unsupported wallet store format version",
    );
  });

  it("rejects a different expected count and duplicate decrypted addresses", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "wallets.operator-wallets.enc.json");
    await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider,
    });
    await expectFailure(
      EncryptedWalletProvider.openOrCreate({ filePath, password: PASSWORD, walletCount: 3, provider: null as unknown as Provider }),
      "wrong password or file integrity failure",
    );

    const wallet = Wallet.createRandom();
    expect(() => validateWalletRecords([
      { index: 0, address: wallet.address, privateKey: wallet.privateKey },
      { index: 1, address: wallet.address, privateKey: wallet.privateKey },
    ], 2)).to.throw("duplicate addresses");
  });

  it("leaves no partial target after an interrupted first write and succeeds on restart", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "wallets.operator-wallets.enc.json");
    await expectFailure(
      EncryptedWalletProvider.openOrCreate({
        filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider,
        hooks: { beforeRename: () => { throw new Error("simulated power loss"); } },
      }),
      "simulated power loss",
    );
    await expectFailure(readFile(filePath, "utf8"), "ENOENT");
    const recovered = await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider,
    });
    expect(recovered.listWallets()).to.have.length(2);
  });

  it("atomically preserves the previous store when replacement is interrupted", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "wallets.operator-wallets.enc.json");
    const provider = await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider,
    });
    const addresses = provider.listWallets().map((wallet) => wallet.address);
    await expectFailure(
      provider.reencrypt(OTHER_PASSWORD, { beforeRename: () => { throw new Error("interrupted replace"); } }),
      "interrupted replace",
    );
    const reopened = await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider,
    });
    expect(reopened.listWallets().map((wallet) => wallet.address)).to.deep.equal(addresses);
  });

  it("atomically replaces a store during successful password rotation", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "wallets.operator-wallets.enc.json");
    const provider = await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider,
    });
    const addresses = provider.listWallets().map((wallet) => wallet.address);
    await provider.reencrypt(OTHER_PASSWORD);
    await expectFailure(
      EncryptedWalletProvider.openOrCreate({ filePath, password: PASSWORD, walletCount: 2, provider: null as unknown as Provider }),
      "wrong password",
    );
    const rotated = await EncryptedWalletProvider.openOrCreate({
      filePath, password: OTHER_PASSWORD, walletCount: 2, provider: null as unknown as Provider,
    });
    expect(rotated.listWallets().map((wallet) => wallet.address)).to.deep.equal(addresses);
  });
});

describe("Operator transaction journal and recovery", function () {
  afterEach(async function () {
    while (directories.length) {
      const directory = directories.pop();
      if (directory?.startsWith(tmpdir())) await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates a stable idempotency key and never duplicates the same operation", async function () {
    const journal = new MemoryTransactionJournal(identity);
    const first = await journal.prepare(meaning);
    const second = await journal.prepare({ ...meaning, parameters: { expectedCount: 0n, expectedPoolId: 1n } });
    expect(first.operationId).to.equal(operationIdFor(meaning));
    expect(second.operationId).to.equal(first.operationId);
    expect(journal.snapshot().operations).to.have.length(1);
  });

  it("persists and restores a journal while rejecting wrong chain and contract identity", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "transactions.operator-journal.json");
    const journal = await JsonTransactionJournal.open(filePath, identity);
    await journal.prepare(meaning);
    expect((await JsonTransactionJournal.open(filePath, identity)).snapshot().operations).to.have.length(1);
    await expectFailure(JsonTransactionJournal.open(filePath, { ...identity, chainId: 84_532n }), "chain ID mismatch");
    await expectFailure(JsonTransactionJournal.open(filePath, { ...identity, contractAddress: PARTICIPANT }), "contract address mismatch");
  });

  it("allows only forward status transitions and requires transaction evidence", async function () {
    const journal = new MemoryTransactionJournal(identity);
    let operation = await journal.prepare(meaning);
    await expectFailure(journal.transition(operation.operationId, "broadcast"), "Unsafe journal transition");
    operation = await journal.transition(operation.operationId, "ready_to_broadcast", { nonce: 7 });
    await expectFailure(journal.transition(operation.operationId, "broadcast"), "requires a transaction hash");
    operation = await journal.transition(operation.operationId, "broadcast", { transactionHash: HASH_A });
    operation = await journal.transition(operation.operationId, "pending");
    operation = await journal.transition(operation.operationId, "confirmed", { receipt: {
      transactionHash: HASH_A, blockNumber: 42, status: 1, gasUsed: "21000",
    } });
    await expectFailure(journal.transition(operation.operationId, "pending"), "Unsafe journal transition");
  });

  it("rejects a corrupted journal and unknown status", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "transactions.operator-journal.json");
    const journal = await JsonTransactionJournal.open(filePath, identity);
    await journal.prepare(meaning);
    const original = journal.snapshot();
    const tampered = structuredClone(original);
    tampered.operations[0].scope = "wallet-9-position-9";
    await writeFile(filePath, JSON.stringify(tampered), "utf8");
    await expectFailure(JsonTransactionJournal.open(filePath, identity), "idempotency integrity check failed");

    const data = structuredClone(original) as unknown as { operations: Array<{ status: string }> };
    data.operations[0].status = "unknown";
    await writeFile(filePath, JSON.stringify(data), "utf8");
    await expectFailure(JsonTransactionJournal.open(filePath, identity), "Journal status is invalid");
    await writeFile(filePath, "{", "utf8");
    await expectFailure(JsonTransactionJournal.open(filePath, identity), "incomplete or invalid JSON");
  });

  it("never broadcasts confirmed or pending operations again", async function () {
    const confirmedJournal = new MemoryTransactionJournal(identity);
    let broadcasts = 0;
    await executeJournaledOperation({
      journal: confirmedJournal, meaning, getNonce: async () => 7,
      broadcast: async () => { broadcasts += 1; return response(); },
    });
    const skipped = await executeJournaledOperation({
      journal: confirmedJournal, meaning, getNonce: async () => 8,
      broadcast: async () => { broadcasts += 1; return response(HASH_B, 8); },
    });
    expect(skipped.skipped).to.equal(true);
    expect(broadcasts).to.equal(1);

    const pendingJournal = new MemoryTransactionJournal(identity);
    await pendingOperation(pendingJournal);
    await expectFailure(executeJournaledOperation({
      journal: pendingJournal, meaning, getNonce: async () => 8,
      broadcast: async () => { broadcasts += 1; return response(HASH_B, 8); },
    }), "Idempotency guard blocked");
    expect(broadcasts).to.equal(1);
  });

  it("recovers confirmed receipts and detects replacement, cancellation, and ambiguity", async function () {
    const confirmedJournal = new MemoryTransactionJournal(identity);
    const confirmedPending = await pendingOperation(confirmedJournal);
    const confirmedProvider = new FakeRecoveryProvider();
    confirmedProvider.receipt = successfulReceipt();
    confirmedProvider.transaction = successfulTransaction();
    const confirmed = await recoverJournalOperation(confirmedJournal, confirmedPending, confirmedProvider);
    expect(confirmed.status).to.equal("confirmed");
    confirmedProvider.transaction = null;
    await expectFailure(
      recoverJournalOperation(confirmedJournal, confirmed, confirmedProvider),
      "cannot be verified by the provider",
    );

    const replacedJournal = new MemoryTransactionJournal(identity);
    const replacedPending = await pendingOperation(replacedJournal);
    const replacedProvider = new FakeRecoveryProvider();
    replacedProvider.replacement = {
      hash: HASH_B, from: PARTICIPANT, to: CONTRACT, nonce: 7, data: "0x1234", value: 0n,
    };
    expect((await recoverJournalOperation(replacedJournal, replacedPending, replacedProvider)).status).to.equal("replaced");

    const cancelledJournal = new MemoryTransactionJournal(identity);
    const cancelledPending = await pendingOperation(cancelledJournal);
    const cancelledProvider = new FakeRecoveryProvider();
    cancelledProvider.replacement = {
      hash: HASH_B, from: PARTICIPANT, to: PARTICIPANT, nonce: 7, data: "0x", value: 0n,
    };
    expect((await recoverJournalOperation(cancelledJournal, cancelledPending, cancelledProvider)).status).to.equal("cancelled");

    const ambiguousJournal = new MemoryTransactionJournal(identity);
    const ambiguousPending = await pendingOperation(ambiguousJournal);
    const ambiguousProvider = new FakeRecoveryProvider();
    ambiguousProvider.pendingNonce = 8;
    expect((await recoverJournalOperation(ambiguousJournal, ambiguousPending, ambiguousProvider)).status).to.equal("requires_manual_review");
  });

  it("handles crashes at every transaction boundary without an uncontrolled duplicate", async function () {
    const preparedJournal = new MemoryTransactionJournal(identity);
    let broadcasts = 0;
    await expectFailure(executeJournaledOperation({
      journal: preparedJournal, meaning, getNonce: async () => 7,
      broadcast: async () => { broadcasts += 1; return response(); },
      failureHook: (point) => { if (point === "after_prepared") throw new Error("crash prepared"); },
    }), "crash prepared");
    expect(preparedJournal.snapshot().operations[0].status).to.equal("prepared");
    await executeJournaledOperation({
      journal: preparedJournal, meaning, getNonce: async () => 7,
      broadcast: async () => { broadcasts += 1; return response(); },
    });
    expect(broadcasts).to.equal(1);

    const readyJournal = new MemoryTransactionJournal(identity);
    await expectFailure(executeJournaledOperation({
      journal: readyJournal, meaning, getNonce: async () => 7,
      broadcast: async () => { broadcasts += 1; return response(); },
      failureHook: (point) => { if (point === "after_ready") throw new Error("crash ready"); },
    }), "crash ready");
    const ready = readyJournal.snapshot().operations[0];
    expect((await recoverJournalOperation(readyJournal, ready, new FakeRecoveryProvider())).status).to.equal("requires_manual_review");
    expect(broadcasts).to.equal(1);

    const unknownBroadcastJournal = new MemoryTransactionJournal(identity);
    await expectFailure(executeJournaledOperation({
      journal: unknownBroadcastJournal, meaning, getNonce: async () => 7,
      broadcast: async () => { broadcasts += 1; throw new Error("connection lost after send"); },
    }), "requires manual review");
    expect(unknownBroadcastJournal.snapshot().operations[0].status).to.equal("requires_manual_review");
    expect(broadcasts).to.equal(2);

    const pendingJournal = new MemoryTransactionJournal(identity);
    await expectFailure(executeJournaledOperation({
      journal: pendingJournal, meaning, getNonce: async () => 7,
      broadcast: async () => { broadcasts += 1; return response(); },
      failureHook: (point) => { if (point === "after_pending") throw new Error("crash pending"); },
    }), "crash pending");
    const pendingProvider = new FakeRecoveryProvider();
    pendingProvider.transaction = {
      hash: HASH_A, from: PARTICIPANT, to: CONTRACT, nonce: 7, data: "0x1234", value: 0n,
    };
    expect((await recoverJournalOperation(pendingJournal, pendingJournal.snapshot().operations[0], pendingProvider)).status).to.equal("pending");
    await expectFailure(executeJournaledOperation({
      journal: pendingJournal, meaning, getNonce: async () => 8,
      broadcast: async () => { broadcasts += 1; return response(HASH_B, 8); },
    }), "Idempotency guard blocked");
    expect(broadcasts).to.equal(3);

    const receiptJournal = new MemoryTransactionJournal(identity);
    await expectFailure(executeJournaledOperation({
      journal: receiptJournal, meaning, getNonce: async () => 7,
      broadcast: async () => { broadcasts += 1; return response(); },
      failureHook: (point) => { if (point === "after_receipt") throw new Error("crash after receipt"); },
    }), "crash after receipt");
    const receiptProvider = new FakeRecoveryProvider();
    receiptProvider.receipt = successfulReceipt();
    receiptProvider.transaction = successfulTransaction();
    expect((await recoverJournalOperation(receiptJournal, receiptJournal.snapshot().operations[0], receiptProvider)).status).to.equal("confirmed");
    expect(broadcasts).to.equal(4);
  });

  it("preserves the previous journal if an atomic update is interrupted", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "transactions.operator-journal.json");
    let failWrite = false;
    const journal = await JsonTransactionJournal.open(filePath, identity, {
      beforeRename: () => { if (failWrite) throw new Error("journal write interrupted"); },
    });
    await journal.prepare(meaning);
    failWrite = true;
    await expectFailure(
      journal.transition(operationIdFor(meaning), "ready_to_broadcast", { nonce: 7 }),
      "journal write interrupted",
    );
    const reopened = await JsonTransactionJournal.open(filePath, identity);
    expect(reopened.snapshot().operations[0].status).to.equal("prepared");
  });

  it("rejects concurrent file ownership and stale journal revisions", async function () {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "transactions.operator-journal.json");
    await withExclusiveFileLock(filePath, async () => {
      await expectFailure(withExclusiveFileLock(filePath, async () => undefined), "locked by another live process");
    });

    const first = await JsonTransactionJournal.open(filePath, identity);
    const stale = await JsonTransactionJournal.open(filePath, identity);
    await first.prepare(meaning);
    await expectFailure(
      stale.prepare({ ...meaning, scope: "wallet-1-position-1", walletAddress: Wallet.createRandom().address }),
      "revision conflict",
    );
  });

  it("resumes between lifecycle operations without replaying the confirmed predecessor", async function () {
    const journal = new MemoryTransactionJournal(identity);
    let broadcasts = 0;
    await executeJournaledOperation({
      journal, meaning, getNonce: async () => 7,
      broadcast: async () => { broadcasts += 1; return response(); },
    });
    const secondMeaning = { ...meaning, action: "withdraw" as const, scope: "position-1-withdrawal", parameters: { positionId: 1n } };
    await expectFailure(executeJournaledOperation({
      journal, meaning: secondMeaning, getNonce: async () => 8,
      broadcast: async () => { broadcasts += 1; return response(HASH_B, 8); },
      failureHook: (point) => { if (point === "after_prepared") throw new Error("next operation crash"); },
    }), "next operation crash");
    expect((await executeJournaledOperation({
      journal, meaning, getNonce: async () => 8,
      broadcast: async () => { broadcasts += 1; return response(HASH_B, 8); },
    })).skipped).to.equal(true);
    await executeJournaledOperation({
      journal, meaning: secondMeaning, getNonce: async () => 8,
      broadcast: async () => { broadcasts += 1; return response(HASH_B, 8); },
    });
    expect(broadcasts).to.equal(2);
  });

  it("sanitizes secrets and blocks Base Sepolia before a broadcaster can run", function () {
    const secret = `0x${"ab".repeat(32)}`;
    const mnemonic = [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
      "theta",
      "iota",
      "kappa",
      "lambda",
      "omega",
    ].join(" ");
    const credentialUrl = ["https://user", "pass@example.test/rpc"].join(":");
    const passwordFixture = ["password", "hunter2"].join("=");
    const sanitized = sanitizeOperatorError(new Error(`${passwordFixture} key=${secret} ${credentialUrl} mnemonic=${mnemonic}`));
    expect(sanitized).not.to.include("hunter2");
    expect(sanitized).not.to.include(secret);
    expect(sanitized).not.to.include("user:pass");
    expect(sanitized).not.to.include(mnemonic);

    expect(() => operationIdFor({ ...meaning, scope: `private key=${secret}` })).to.throw(
      "secret-like data",
    );

    let broadcastCalled = false;
    expect(() => {
      assertExecutionPolicy({ mode: "join-to-99", network: "baseSepolia" });
      broadcastCalled = true;
    }).to.throw("Base Sepolia write blocked");
    expect(broadcastCalled).to.equal(false);
  });
});
