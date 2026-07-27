import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXACT_99_WALLET_STORE_V2_FIXTURE_PURPOSE,
  EXACT_99_WALLET_STORE_V2_FIXTURE_SUFFIX,
  buildExact99WalletStoreV2Fixture,
  createExact99WalletStoreV2FixtureFile,
  describeExact99WalletStoreV2Migration,
  inspectExact99WalletStoreV2Fixture,
  openSelectedExact99WalletStoreV2FixtureRecord,
  readAndInspectExact99WalletStoreV2FixtureFile,
  verifyExact99WalletStoreV2FixtureBinding,
  type Exact99WalletStoreV2FixtureEnvelope,
  type Exact99WalletStoreV2FixtureRecordInput,
} from "../scripts/operator/exact-99-wallet-store-v2-fixture.js";

const CREATED_AT = "2026-07-27T12:00:00.000Z";
const STORE_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_PASSWORD = "fixture-only-password";

function address(index: number): string {
  return `0x${(index + 50_000).toString(16).padStart(40, "0")}`;
}

function records(): Exact99WalletStoreV2FixtureRecordInput[] {
  return Array.from({ length: 99 }, (_, index) => ({
    index,
    address: address(index),
    fixtureKeyMaterial: `fixture-only:wallet-${index.toString().padStart(2, "0")}:not-a-real-key`,
  }));
}

let envelope: Exact99WalletStoreV2FixtureEnvelope;

describe("exact-99 wallet store v2 fixture prototype", function () {
  before(async function () {
    this.timeout(30_000);
    envelope = await buildExact99WalletStoreV2Fixture({
      records: records(),
      fixturePassword: FIXTURE_PASSWORD,
      createdAt: CREATED_AT,
      storeId: STORE_ID,
    });
  });

  it("uses a versioned fixture-only envelope with 99 separately encrypted records", function () {
    const inspection = inspectExact99WalletStoreV2Fixture(envelope);
    assert.equal(envelope.formatVersion, 2);
    assert.equal(envelope.purpose, EXACT_99_WALLET_STORE_V2_FIXTURE_PURPOSE);
    assert.equal(envelope.records.length, 99);
    assert.equal(inspection.walletCount, 99);
    assert.equal(inspection.fixtureOnly, true);
    assert.equal(new Set(envelope.records.map((record) => record.salt)).size, 99);
    assert.equal(new Set(envelope.records.map((record) => record.iv)).size, 99);
    assert.doesNotThrow(() => verifyExact99WalletStoreV2FixtureBinding({
      inspection,
      expected: {
        storeId: STORE_ID,
        orderDigest: envelope.orderDigest,
        integrityDigest: envelope.integrityDigest,
      },
    }));
    assert.throws(() => verifyExact99WalletStoreV2FixtureBinding({
      inspection,
      expected: {
        storeId: STORE_ID,
        orderDigest: envelope.orderDigest,
        integrityDigest: `sha256:${"ff".repeat(32)}`,
      },
    }), /external manifest binding/);
  });

  it("opens one selected record without returning any other fixture key material", async function () {
    const selected = await openSelectedExact99WalletStoreV2FixtureRecord({
      envelope,
      index: 37,
      fixturePassword: FIXTURE_PASSWORD,
    });
    assert.deepEqual(selected, {
      fixtureOnly: true,
      storeId: STORE_ID,
      index: 37,
      address: address(37),
      fixtureKeyMaterial: "fixture-only:wallet-37:not-a-real-key",
    });
    assert.equal(Object.keys(selected).includes("records"), false);
  });

  it("rejects an incorrect fixture password for the selected record", async function () {
    await assert.rejects(() => openSelectedExact99WalletStoreV2FixtureRecord({
      envelope,
      index: 37,
      fixturePassword: "another-fixture-password",
    }), /Unable to decrypt selected fixture record/);
  });

  it("detects a missing encrypted record before any decryption", function () {
    const changed = structuredClone(envelope);
    changed.records.pop();
    assert.throws(() => inspectExact99WalletStoreV2Fixture(changed), /missing record/);
  });

  it("detects reordered encrypted records before any decryption", function () {
    const changed = structuredClone(envelope);
    [changed.records[1], changed.records[2]] = [changed.records[2], changed.records[1]];
    assert.throws(() => inspectExact99WalletStoreV2Fixture(changed), /record order changed/);
  });

  it("detects a changed encrypted record and whole-set substitution", function () {
    const changed = structuredClone(envelope);
    changed.records[10].ciphertext = changed.records[11].ciphertext;
    assert.throws(() => inspectExact99WalletStoreV2Fixture(changed), /record 10 was changed/);
  });

  it("rejects input that resembles real key material", async function () {
    const changed = records();
    changed[0].fixtureKeyMaterial = `0x${"11".repeat(32)}`;
    await assert.rejects(() => buildExact99WalletStoreV2Fixture({
      records: changed,
      fixturePassword: FIXTURE_PASSWORD,
      createdAt: CREATED_AT,
      storeId: STORE_ID,
    }), /fixture key material only/);
  });

  it("requires exactly 99 fixture records", async function () {
    await assert.rejects(() => buildExact99WalletStoreV2Fixture({
      records: records().slice(0, 98),
      fixturePassword: FIXTURE_PASSWORD,
      createdAt: CREATED_AT,
      storeId: STORE_ID,
    }), /exactly 99 records/);
  });

  it("writes only a fixture-labelled create-only file and refuses overwrite", async function () {
    const directory = await mkdtemp(join(tmpdir(), "pop33-store-v2-fixture-"));
    const filePath = join(directory, `exact-99${EXACT_99_WALLET_STORE_V2_FIXTURE_SUFFIX}`);
    try {
      const written = await createExact99WalletStoreV2FixtureFile({ filePath, envelope });
      assert.equal(written.storeId, STORE_ID);
      assert.match(written.fileFingerprint!, /^sha256:/);
      const inspected = await readAndInspectExact99WalletStoreV2FixtureFile(filePath);
      assert.equal(inspected.integrityDigest, envelope.integrityDigest);
      await assert.rejects(
        () => createExact99WalletStoreV2FixtureFile({ filePath, envelope }),
        /create-only mode refuses overwrite/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps v1-to-v2 migration unimplemented and separately authorized", function () {
    assert.deepEqual(describeExact99WalletStoreV2Migration(), {
      implemented: false,
      requiresSeparateAuthorization: true,
      reason: "Migration from store v1 is intentionally deferred and must never run implicitly.",
    });
  });
});
