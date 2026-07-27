import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXACT_99_FILES,
  appendExact99JournalEntry,
  buildEmptyExact99Journal,
  buildExact99Manifest,
  buildInitialExact99ArtifactSet,
  exact99ManifestFingerprint,
  preflightExact99OperatorArtifacts,
  readExact99ArtifactSet,
  renderExact99Preflight,
  updateExact99Checkpoint,
  validateExact99Checkpoint,
  validateExact99Journal,
  validateExact99Manifest,
  writeInitialExact99Artifacts,
  type Exact99Checkpoint,
  type Exact99Journal,
  type Exact99JournalEntry,
} from "../scripts/operator/exact-99-operator-artifacts.js";
import type { EncryptedWalletStoreInspection } from "../scripts/operator/encrypted-wallet-store.js";
import {
  PILOT_SET_WALLET_COUNT,
  createPilotSetBinding,
  validateOperatorSetBinding,
} from "../scripts/operator/operator-set-identity.js";

const CREATED_AT = "2026-07-27T12:00:00.000Z";
const SET_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_STORE_ID = "33333333-3333-4333-8333-333333333333";
const STORE_FINGERPRINT = `sha256:${"ab".repeat(32)}`;
const OTHER_FINGERPRINT = `sha256:${"cd".repeat(32)}`;
const HASH = `0x${"12".repeat(32)}`;
const directories: string[] = [];

function fixtureAddress(index: number): string {
  return `0x${(index + 1_000).toString(16).padStart(40, "0")}`;
}

function addresses(count = 99): string[] {
  return Array.from({ length: count }, (_, index) => fixtureAddress(index));
}

function store(overrides: Partial<EncryptedWalletStoreInspection> = {}): EncryptedWalletStoreInspection {
  return {
    formatVersion: 1,
    storeId: STORE_ID,
    walletCount: 99,
    addresses: addresses(),
    fingerprint: STORE_FINGERPRINT,
    ...overrides,
  };
}

function artifacts() {
  return buildInitialExact99ArtifactSet(store(), CREATED_AT, SET_ID);
}

function checkpointAt(count: 5 | 20 | 50 | 99): Exact99Checkpoint {
  const fixture = artifacts();
  return validateExact99Checkpoint({
    ...fixture.checkpoint,
    stage: `checkpoint-${count}`,
    confirmedWalletCount: count,
    counters: {
      funded: count,
      faucet: count,
      approve: count,
      join: count,
      draw: 0,
      claim: 0,
    },
    updatedAt: CREATED_AT,
  }, fixture.manifest);
}

function journalEntry(
  status: Exact99JournalEntry["status"],
  overrides: Partial<Exact99JournalEntry> = {},
): Exact99JournalEntry {
  return {
    sequence: 1,
    operationId: randomUUID(),
    type: "join",
    walletIndex: 0,
    walletAddress: fixtureAddress(0),
    expectedState: "pool 1 Open with the expected participant count",
    transactionHash: status === "prepared" || status === "manual-review" ? null : HASH,
    status,
    blockNumber: status === "confirmed" ? 123 : null,
    receipt: status === "confirmed" ? { status: 1, gasUsed: "100000" } : null,
    reconciliation: status === "confirmed" ? "join count and escrow matched" : null,
    error: status === "manual-review" ? "receipt outcome requires independent review" : null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function journalWith(entry: Exact99JournalEntry): Exact99Journal {
  const fixture = artifacts();
  return validateExact99Journal({
    ...fixture.journal,
    revision: 1,
    entries: [entry],
  }, fixture.manifest);
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-exact-99-artifacts-"));
  directories.push(directory);
  return directory;
}

describe("exact-99 operator artifact profile", function () {
  afterEach(async function () {
    while (directories.length > 0) {
      await rm(directories.pop()!, { recursive: true, force: true });
    }
  });

  it("binds exactly 99 unique ordered public addresses to the encrypted store fingerprint", function () {
    const fixture = artifacts();
    assert.equal(fixture.manifest.walletCount, 99);
    assert.equal(fixture.manifest.walletAddresses.length, 99);
    assert.equal(new Set(fixture.manifest.walletAddresses.map((value) => value.toLowerCase())).size, 99);
    assert.equal(fixture.manifest.storeId, STORE_ID);
    assert.equal(fixture.manifest.storeFingerprint, STORE_FINGERPRINT);
    assert.equal(fixture.manifest.automaticJoinHardStop, 99);
    assert.match(exact99ManifestFingerprint(fixture.manifest), /^sha256:[0-9a-f]{64}$/);
  });

  it("rejects stores containing 98 or 100 addresses", function () {
    for (const count of [98, 100]) {
      assert.throws(
        () => buildExact99Manifest(store({
          walletCount: count,
          addresses: addresses(count),
        }), CREATED_AT, SET_ID),
        /exactly 99/,
      );
    }
  });

  it("rejects a duplicate address", function () {
    const duplicated = addresses();
    duplicated[98] = duplicated[0];
    assert.throws(
      () => buildExact99Manifest(store({ addresses: duplicated }), CREATED_AT, SET_ID),
      /duplicate/,
    );
  });

  it("detects a changed wallet order", function () {
    const fixture = artifacts();
    const changed = addresses();
    [changed[0], changed[1]] = [changed[1], changed[0]];
    const report = preflightExact99OperatorArtifacts({
      store: store({ addresses: changed }),
      ...fixture,
    });
    assert.equal(report.readyForFutureNetworkPreflight, false);
    assert.match(report.blockers.join("\n"), /wallet order/i);
  });

  it("detects a mismatched store ID and encrypted-store fingerprint", function () {
    const fixture = artifacts();
    const wrongId = preflightExact99OperatorArtifacts({
      store: store({ storeId: OTHER_STORE_ID }),
      ...fixture,
    });
    assert.match(wrongId.blockers.join("\n"), /store ID/i);

    const wrongFingerprint = preflightExact99OperatorArtifacts({
      store: store({ fingerprint: OTHER_FINGERPRINT }),
      ...fixture,
    });
    assert.match(wrongFingerprint.blockers.join("\n"), /fingerprint/i);
  });

  it("requires one shared manifest, checkpoint, and journal identity", function () {
    const fixture = artifacts();
    const changedCheckpoint = structuredClone(fixture.checkpoint) as Exact99Checkpoint;
    changedCheckpoint.storeId = OTHER_STORE_ID;
    const report = preflightExact99OperatorArtifacts({
      store: store(),
      manifest: fixture.manifest,
      checkpoint: changedCheckpoint,
      journal: fixture.journal,
    });
    assert.equal(report.readyForFutureNetworkPreflight, false);
    assert.match(report.blockers.join("\n"), /checkpoint.*store ID mismatch|artifact set is incomplete/i);
  });

  it("starts with an empty valid append-only journal and no network operations", function () {
    const fixture = artifacts();
    assert.equal(fixture.journal.revision, 0);
    assert.deepEqual(fixture.journal.entries, []);
    assert.equal(fixture.checkpoint.stage, "initialized");
    assert.equal(fixture.checkpoint.confirmedWalletCount, 0);
    assert.deepEqual(fixture.checkpoint.counters, {
      funded: 0,
      faucet: 0,
      approve: 0,
      join: 0,
      draw: 0,
      claim: 0,
    });
    assert.deepEqual(fixture.checkpoint.recovery, {
      pending: false,
      ambiguous: false,
      manualReview: false,
      reason: null,
    });
  });

  it("detects pending, ambiguous, and manual-review journal work", function () {
    for (const status of ["pending", "ambiguous", "manual-review"] as const) {
      const fixture = artifacts();
      const report = preflightExact99OperatorArtifacts({
        store: store(),
        manifest: fixture.manifest,
        checkpoint: fixture.checkpoint,
        journal: journalWith(journalEntry(status)),
      });
      assert.equal(report.readyForFutureNetworkPreflight, false);
      assert.match(report.blockers.join("\n"), /pending, ambiguous, or manual-review/i);
    }
  });

  it("validates cumulative lifecycle checkpoints 5, 20, 50, and 99", function () {
    for (const count of [5, 20, 50, 99] as const) {
      const checkpoint = checkpointAt(count);
      assert.equal(checkpoint.stage, `checkpoint-${count}`);
      assert.equal(checkpoint.confirmedWalletCount, count);
      assert.equal(checkpoint.counters.join, count);
    }
    const fixture = artifacts();
    assert.throws(() => validateExact99Checkpoint({
      ...fixture.checkpoint,
      stage: "checkpoint-50",
      confirmedWalletCount: 49,
      counters: { funded: 50, faucet: 50, approve: 50, join: 49, draw: 0, claim: 0 },
    }, fixture.manifest), /requires exactly 50/);
  });

  it("enforces the automatic hard stop before a 100th operator join", function () {
    const fixture = artifacts();
    const changedManifest = {
      ...fixture.manifest,
      automaticJoinHardStop: 100,
    };
    assert.throws(() => validateExact99Manifest(changedManifest), /hard stop must equal 99/);

    const invalidJournal = {
      ...fixture.journal,
      revision: 1,
      entries: [journalEntry("prepared", {
        walletIndex: null,
        walletAddress: null,
      })],
    };
    const report = preflightExact99OperatorArtifacts({
      store: store(),
      manifest: fixture.manifest,
      checkpoint: checkpointAt(99),
      journal: invalidJournal,
    });
    assert.equal(report.readyForFutureNetworkPreflight, false);
    assert.match(report.blockers.join("\n"), /automatic join without a bounded wallet index/i);

    const duplicateAttempts = {
      ...fixture.journal,
      revision: 2,
      entries: [
        journalEntry("prepared", { operationId: randomUUID() }),
        journalEntry("prepared", { sequence: 2, operationId: randomUUID() }),
      ],
    };
    const duplicateReport = preflightExact99OperatorArtifacts({
      store: store(),
      manifest: fixture.manifest,
      checkpoint: fixture.checkpoint,
      journal: duplicateAttempts,
    });
    assert.equal(duplicateReport.readyForFutureNetworkPreflight, false);
    assert.match(duplicateReport.blockers.join("\n"), /duplicate or 100th automatic join attempt/i);
  });

  it("writes create-only local artifacts, reads them, and appends without rewriting prior entries", async function () {
    const directory = await temporaryDirectory();
    const fixture = artifacts();
    await writeInitialExact99Artifacts(directory, fixture);
    const opened = await readExact99ArtifactSet(directory);
    assert.deepEqual(opened, fixture);
    await assert.rejects(writeInitialExact99Artifacts(directory, fixture), /will not overwrite/);

    const { sequence: _sequence, ...preparedEntry } = journalEntry("prepared");
    const appended = await appendExact99JournalEntry(directory, fixture.manifest, preparedEntry);
    assert.equal(appended.revision, 1);
    assert.equal(appended.entries.length, 1);
    assert.equal(appended.entries[0].sequence, 1);

    const persisted = await readExact99ArtifactSet(directory);
    assert.deepEqual(persisted.journal, appended);
    assert.deepEqual(persisted.manifest, fixture.manifest);
    assert.deepEqual(persisted.checkpoint, fixture.checkpoint);
  });

  it("appends safe status transitions for one operation and evaluates only its latest state", async function () {
    const directory = await temporaryDirectory();
    const fixture = artifacts();
    await writeInitialExact99Artifacts(directory, fixture);
    const operationId = randomUUID();
    const prepared = journalEntry("prepared", { operationId });
    const { sequence: _preparedSequence, ...preparedValue } = prepared;
    await appendExact99JournalEntry(directory, fixture.manifest, preparedValue);

    const pending = journalEntry("pending", {
      operationId,
      createdAt: prepared.createdAt,
      updatedAt: "2026-07-27T12:01:00.000Z",
    });
    const { sequence: _pendingSequence, ...pendingValue } = pending;
    await appendExact99JournalEntry(directory, fixture.manifest, pendingValue);

    const failed = journalEntry("failed", {
      operationId,
      createdAt: prepared.createdAt,
      updatedAt: "2026-07-27T12:02:00.000Z",
    });
    const { sequence: _failedSequence, ...failedValue } = failed;
    const completed = await appendExact99JournalEntry(directory, fixture.manifest, failedValue);
    assert.equal(completed.revision, 3);
    assert.deepEqual(completed.entries.map((entry) => entry.status), [
      "prepared",
      "pending",
      "failed",
    ]);
    const report = preflightExact99OperatorArtifacts({
      store: store(),
      manifest: fixture.manifest,
      checkpoint: fixture.checkpoint,
      journal: completed,
    });
    assert.equal(report.readyForFutureNetworkPreflight, true);
  });

  it("updates checkpoints atomically, detects stale writers, and rejects backward stages", async function () {
    const directory = await temporaryDirectory();
    const fixture = artifacts();
    await writeInitialExact99Artifacts(directory, fixture);
    const inspected = validateExact99Checkpoint({
      ...fixture.checkpoint,
      stage: "inspected",
      updatedAt: "2026-07-27T12:05:00.000Z",
    }, fixture.manifest);
    assert.deepEqual(
      await updateExact99Checkpoint(
        directory,
        fixture.manifest,
        inspected,
        fixture.checkpoint.updatedAt,
      ),
      inspected,
    );
    await assert.rejects(
      updateExact99Checkpoint(
        directory,
        fixture.manifest,
        inspected,
        fixture.checkpoint.updatedAt,
      ),
      /revision conflict/,
    );
    const backwards = validateExact99Checkpoint({
      ...fixture.checkpoint,
      updatedAt: "2026-07-27T12:06:00.000Z",
    }, fixture.manifest);
    await assert.rejects(
      updateExact99Checkpoint(
        directory,
        fixture.manifest,
        backwards,
        inspected.updatedAt,
      ),
      /cannot move backwards/,
    );
  });

  it("redacts secret-like fixture input from preflight reports and rejects secret fields", function () {
    const fixture = artifacts();
    const secret = "hunter2-fixture-secret";
    const changedJournal = {
      ...fixture.journal,
      unexpectedPassword: secret,
    };
    const report = preflightExact99OperatorArtifacts({
      store: store(),
      manifest: fixture.manifest,
      checkpoint: fixture.checkpoint,
      journal: changedJournal,
    });
    const rendered = renderExact99Preflight(report);
    assert.equal(rendered.includes(secret), false);
    assert.doesNotMatch(rendered, /private.?key\s*[:=]\s*0x/i);
    assert.match(rendered, /No RPC connection, signing, transaction/);

    assert.throws(() => validateExact99Manifest({
      ...fixture.manifest,
      privateKey: `0x${"ef".repeat(32)}`,
    }), /forbidden/);
  });

  it("keeps the existing five-wallet pilot binding compatible", function () {
    const pilotAddresses = addresses(PILOT_SET_WALLET_COUNT);
    const binding = createPilotSetBinding(
      "44444444-4444-4444-8444-444444444444",
      pilotAddresses,
    );
    assert.equal(binding.walletCount, 5);
    assert.deepEqual(validateOperatorSetBinding(binding), binding);
  });

  it("contains no wallet generation, RPC, signing, or transaction transport", async function () {
    const source = await readFile(
      new URL("../scripts/operator/exact-99-operator-artifacts.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /Wallet\.createRandom|JsonRpcProvider|sendTransaction|sendRawTransaction|writeContract|\bSigner\b/);
    assert.equal(Object.values(EXACT_99_FILES).some((name) => name.includes("fixture")), false);
  });

  it("can independently construct and validate the empty journal format", function () {
    const manifest = buildExact99Manifest(store(), CREATED_AT, SET_ID);
    const journal = buildEmptyExact99Journal(manifest, CREATED_AT);
    assert.deepEqual(validateExact99Journal(journal, manifest), journal);
  });
});
