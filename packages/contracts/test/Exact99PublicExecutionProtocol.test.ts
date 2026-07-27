import assert from "node:assert/strict";

import {
  EXACT_99_BOUNDARY_AUTHORIZATION,
  EXACT_99_BOUNDARY_THREAT_ACKNOWLEDGMENT,
  EXACT_99_PROTOCOL_FAULT_POINTS,
  EXACT_99_PUBLIC_ACCUMULATION_RANGES,
  EXACT_99_PUBLIC_PROTOCOL_STEPS,
  EXACT_99_REPLACEMENT_AUTHORIZATION,
  EXACT_99_STALE_LOCK_TAKEOVER_AUTHORIZATION,
  FixtureExact99GlobalRunLockRegistry,
  appendPlannedExact99Attempt,
  assessExact99FixtureFinality,
  buildEmptyExact99JournalV2,
  buildExact99DualSourceEvidence,
  buildExact99UnsignedRequest,
  createExact99ReplacementAttempt,
  deriveExact99FixtureCheckpointUpdate,
  evaluateExact99Boundary99,
  evaluateExact99FixtureFeeGuard,
  exact99FixtureDigest,
  inspectExact99FixtureNonce,
  inspectExact99Recovery,
  parseExact99JournalV2,
  serializeExact99JournalV2,
  transitionExact99Attempt,
  validateExact99JournalV2,
  type Exact99DualSourceEvidence,
  type Exact99DualSourceSnapshot,
  type Exact99FinalityAssessment,
  type Exact99FixtureFeeLimits,
  type Exact99FixtureNonceDecision,
  type Exact99GlobalRunLock,
  type Exact99JournalV2,
  type Exact99JournalV2Attempt,
  type Exact99JournalV2State,
  type Exact99RecoveryEvidence,
} from "../scripts/operator/exact-99-public-execution-protocol.js";

const SET_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_ID = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const REPLACEMENT_ATTEMPT_ID = "66666666-6666-4666-8666-666666666666";
const MANIFEST_FINGERPRINT = `sha256:${"ab".repeat(32)}`;
const CONTRACT = "0x0000000000000000000000000000000000000100";
const TOKEN = "0x0000000000000000000000000000000000000200";
const WALLET = "0x0000000000000000000000000000000000000300";
const TX_HASH = `0x${"11".repeat(32)}`;
const BLOCK_HASH = `0x${"22".repeat(32)}`;
const PARENT_HASH = `0x${"33".repeat(32)}`;
const TRANSPORT_HASH = TX_HASH;
const DIGEST_A = `sha256:${"aa".repeat(32)}`;
const DIGEST_B = `sha256:${"bb".repeat(32)}`;
const DIGEST_C = `sha256:${"cc".repeat(32)}`;
const CREATED_AT = "2026-07-27T12:00:00.000Z";

function at(offset: number): string {
  return new Date(Date.parse(CREATED_AT) + offset * 1_000).toISOString();
}

function emptyJournal(): Exact99JournalV2 {
  return buildEmptyExact99JournalV2({
    setId: SET_ID,
    storeId: STORE_ID,
    manifestFingerprint: MANIFEST_FINGERPRINT,
    runId: RUN_ID,
  }, CREATED_AT);
}

function plannedJournal(): Exact99JournalV2 {
  return appendPlannedExact99Attempt(emptyJournal(), {
    setId: SET_ID,
    storeId: STORE_ID,
    manifestFingerprint: MANIFEST_FINGERPRINT,
    runId: RUN_ID,
    checkpoint: "checkpoint-5",
    rangeStart: 0,
    rangeEnd: 4,
    walletIndex: 0,
    walletAddress: WALLET,
    operationId: OPERATION_ID,
    attemptId: ATTEMPT_ID,
    operationType: "join",
    signerRole: "participant",
    chainId: "84532",
    contractAddress: CONTRACT,
    tokenAddress: TOKEN,
    target: CONTRACT,
    valueWei: "0",
    calldataDigest: DIGEST_A,
    beforeStateDigest: DIGEST_B,
    timestamp: at(1),
  });
}

function latest(journal: Exact99JournalV2, attemptId = ATTEMPT_ID): Exact99JournalV2Attempt {
  return journal.entries.filter((entry) => entry.attemptId === attemptId).at(-1)!;
}

function journalAt(state: Exact99JournalV2State): Exact99JournalV2 {
  let journal = plannedJournal();
  if (state === "planned") return journal;
  journal = transitionExact99Attempt(journal, ATTEMPT_ID, "prepared", {}, at(2));
  if (state === "prepared") return journal;
  const built = buildExact99UnsignedRequest({
    chainId: "84532",
    target: CONTRACT,
    valueWei: "0",
    calldataDigest: DIGEST_A,
    nonce: 7,
    gasLimit: "120000",
    maxFeePerGasWei: "100",
    maxPriorityFeePerGasWei: "10",
    totalFeeCapWei: "12000000",
  });
  journal = transitionExact99Attempt(journal, ATTEMPT_ID, "nonce-reserved", {
    nonce: 7,
    unsignedRequest: built.request,
    requestDigest: built.requestDigest,
    gasLimit: built.request.gasLimit,
    maxFeePerGasWei: built.request.maxFeePerGasWei,
    maxPriorityFeePerGasWei: built.request.maxPriorityFeePerGasWei,
    totalFeeCapWei: built.request.totalFeeCapWei,
  }, at(3));
  if (state === "nonce-reserved") return journal;
  journal = transitionExact99Attempt(journal, ATTEMPT_ID, "signed", {
    rawTransactionCreated: true,
    signedTransactionHash: TX_HASH,
  }, at(4));
  if (state === "signed") return journal;
  journal = transitionExact99Attempt(journal, ATTEMPT_ID, "broadcast-attempted", {
    broadcastAttempted: true,
    broadcastRpcIdentity: "fixture-broadcast-source",
    transportTransactionHash: TRANSPORT_HASH,
    recoveryStatus: "pending",
  }, at(5));
  if (state === "broadcast-attempted") return journal;
  journal = transitionExact99Attempt(journal, ATTEMPT_ID, "pending", {}, at(6));
  if (state === "pending") return journal;
  journal = transitionExact99Attempt(journal, ATTEMPT_ID, "mined", {
    blockNumber: 1_000,
    blockHash: BLOCK_HASH,
    transactionIndex: 3,
    receiptStatus: 1,
    confirmationDepth: 1,
    finalityState: "mined",
  }, at(7));
  if (state === "mined") return journal;
  journal = transitionExact99Attempt(journal, ATTEMPT_ID, "reconciling", {
    semanticReconciliation: "matched",
    afterStateDigest: DIGEST_C,
    finalityState: "canonical",
    confirmationDepth: 3,
  }, at(8));
  if (state === "reconciling") return journal;
  journal = transitionExact99Attempt(journal, ATTEMPT_ID, "confirmed", {
    finalityState: "confirmed",
    confirmationDepth: 5,
    recoveryStatus: "clean",
  }, at(9));
  if (state === "confirmed") return journal;
  if (state === "checkpoint-final") {
    return transitionExact99Attempt(journal, ATTEMPT_ID, "checkpoint-final", {
      finalityState: "checkpoint-final",
      confirmationDepth: 8,
      canonicalRecheckEvidenceDigest: DIGEST_A,
    }, at(10));
  }
  throw new Error(`Unsupported journal fixture state ${state}.`);
}

function snapshot(overrides: Partial<Exact99DualSourceSnapshot> = {}): Exact99DualSourceSnapshot {
  return {
    sourceId: "fixture-source-a",
    chainId: "84532",
    blockNumber: 900,
    blockHash: BLOCK_HASH,
    parentHash: PARENT_HASH,
    timestamp: CREATED_AT,
    contractCodeHash: DIGEST_A,
    tokenCodeHash: DIGEST_B,
    abiDigest: DIGEST_C,
    contractParametersDigest: MANIFEST_FINGERPRINT,
    operationStateDigest: exact99FixtureDigest({ positions: 98, status: "Open" }),
    ...overrides,
  };
}

function evidence(
  overridesA: Partial<Exact99DualSourceSnapshot> = {},
  overridesB: Partial<Exact99DualSourceSnapshot> = {},
): Exact99DualSourceEvidence {
  return buildExact99DualSourceEvidence({
    sourceA: snapshot({ sourceId: "fixture-source-a", ...overridesA }),
    sourceB: snapshot({ sourceId: "fixture-source-b", ...overridesB }),
    manifestIdentity: {
      chainId: "84532",
      contractCodeHash: DIGEST_A,
      tokenCodeHash: DIGEST_B,
      abiDigest: DIGEST_C,
      contractParametersDigest: MANIFEST_FINGERPRINT,
    },
  });
}

function finality(overrides: Partial<Exact99FinalityAssessment> = {}): Exact99FinalityAssessment {
  return {
    finalityState: "canonical",
    confirmationDepth: 2,
    mayConfirm: false,
    mayFinalizeCheckpoint: false,
    reorgDetected: false,
    reason: "fixture",
    ...overrides,
  };
}

function recoveryEvidence(overrides: Partial<Exact99RecoveryEvidence> = {}): Exact99RecoveryEvidence {
  return {
    transportLookup: "not-checked",
    receiptStatus: null,
    semanticReconciliation: "not-run",
    finalityAssessment: null,
    broadcastMayHaveOccurred: false,
    ...overrides,
  };
}

function freeNonce(): Exact99FixtureNonceDecision {
  return {
    allowed: true,
    nonce: 9,
    decision: "reserve-next",
    reason: "fixture",
    mutexNamespace: `participant:${WALLET.toLowerCase()}`,
  };
}

function runLock(overrides: Partial<Exact99GlobalRunLock> = {}): Exact99GlobalRunLock {
  const journal = emptyJournal();
  return {
    runId: RUN_ID,
    setId: SET_ID,
    storeId: STORE_ID,
    manifestFingerprint: MANIFEST_FINGERPRINT,
    journalChecksum: journal.checksum,
    journalRevision: journal.revision,
    pid: 1234,
    hostId: "fixture-host",
    startedAt: CREATED_AT,
    checkpoint: "checkpoint-5",
    signerRole: "none",
    walletIndex: null,
    operationId: null,
    state: "active",
    manualReviewReason: null,
    ...overrides,
  };
}

describe("exact-99 public execution protocol fixture", function () {
  it("defines the complete ordered 23-step public protocol without a transport step implementation", function () {
    assert.equal(EXACT_99_PUBLIC_PROTOCOL_STEPS.length, 23);
    assert.equal(EXACT_99_PUBLIC_PROTOCOL_STEPS[0], "acquire-global-run-lock");
    assert.equal(EXACT_99_PUBLIC_PROTOCOL_STEPS[11], "persist-signed-before-broadcast");
    assert.equal(EXACT_99_PUBLIC_PROTOCOL_STEPS.at(-1),
      "close-fixture-signer-session-and-release-run-lock");
  });

  it("keeps checkpoints 5, 20 and 50, ends normal public accumulation at index 97, and isolates index 98", function () {
    assert.deepEqual(EXACT_99_PUBLIC_ACCUMULATION_RANGES.map((range) =>
      [range.checkpoint, range.startIndex, range.endIndex]), [
      ["checkpoint-5", 0, 4],
      ["checkpoint-20", 5, 19],
      ["checkpoint-50", 20, 49],
      ["checkpoint-99-normal", 50, 97],
      ["boundary-99", 98, 98],
    ]);
  });

  it("builds and validates a checksummed append-only journal v2", function () {
    const journal = journalAt("checkpoint-final");
    assert.equal(validateExact99JournalV2(journal).revision, 10);
    assert.equal(latest(journal).state, "checkpoint-final");
    assert.equal(latest(journal).nonce, 7);
    assert.equal(latest(journal).signedTransactionHash, TX_HASH);
    assert.deepEqual(parseExact99JournalV2(serializeExact99JournalV2(journal)), journal);
  });

  it("rejects a backward state transition", function () {
    assert.throws(
      () => transitionExact99Attempt(journalAt("signed"), ATTEMPT_ID, "prepared", {}, at(20)),
      /Invalid forward transition/,
    );
  });

  it("cannot persist confirmed without a successful receipt and matched reconciliation", function () {
    const journal = journalAt("reconciling");
    assert.throws(
      () => transitionExact99Attempt(journal, ATTEMPT_ID, "confirmed", {
        semanticReconciliation: "mismatched",
        finalityState: "confirmed",
      }, at(20)),
      /requires a successful receipt and matched reconciliation/,
    );
  });

  it("cannot persist checkpoint-final without canonical recheck evidence", function () {
    assert.throws(
      () => transitionExact99Attempt(journalAt("confirmed"), ATTEMPT_ID, "checkpoint-final", {
        finalityState: "checkpoint-final",
        confirmationDepth: 8,
      }, at(20)),
      /canonical recheck/,
    );
  });

  it("derives a checkpoint update only after checkpoint-final", function () {
    const derived = deriveExact99FixtureCheckpointUpdate(latest(journalAt("checkpoint-final")));
    assert.equal(derived.derivedOnly, true);
    assert.equal(derived.transactionHash, TRANSPORT_HASH);
    assert.throws(() => deriveExact99FixtureCheckpointUpdate(latest(journalAt("confirmed"))),
      /Only a checkpoint-final attempt/);
  });

  it("requires explicit authorization and a new attempt ID for replacement", function () {
    const pending = journalAt("pending");
    assert.throws(() => createExact99ReplacementAttempt({
      journal: pending,
      originalAttemptId: ATTEMPT_ID,
      newAttemptId: REPLACEMENT_ATTEMPT_ID,
      authorizationPhrase: "no",
      timestamp: at(30),
    }), /explicit fixture authorization/);
    assert.throws(() => createExact99ReplacementAttempt({
      journal: pending,
      originalAttemptId: ATTEMPT_ID,
      newAttemptId: REPLACEMENT_ATTEMPT_ID,
      authorizationPhrase: EXACT_99_REPLACEMENT_AUTHORIZATION,
      timestamp: at(30),
    }), /durably marked replaced/);
    const marked = transitionExact99Attempt(pending, ATTEMPT_ID, "replaced", {
      manualReviewReason: "Fixture replacement was explicitly approved and observed.",
      recoveryStatus: "manual-review",
    }, at(29));
    const replacement = createExact99ReplacementAttempt({
      journal: marked,
      originalAttemptId: ATTEMPT_ID,
      newAttemptId: REPLACEMENT_ATTEMPT_ID,
      authorizationPhrase: EXACT_99_REPLACEMENT_AUTHORIZATION,
      timestamp: at(30),
    });
    assert.equal(latest(replacement, REPLACEMENT_ATTEMPT_ID).replacementOfAttemptId, ATTEMPT_ID);
    assert.equal(latest(replacement, REPLACEMENT_ATTEMPT_ID).state, "planned");
  });

  it("rejects wallet index 99 from every automatic protocol attempt", function () {
    const source = plannedJournal().entries[0];
    assert.throws(() => appendPlannedExact99Attempt(emptyJournal(), {
      setId: source.setId,
      storeId: source.storeId,
      runId: source.runId,
      manifestFingerprint: source.manifestFingerprint,
      checkpoint: "manual",
      rangeStart: 99,
      rangeEnd: 99,
      walletIndex: 99,
      walletAddress: source.walletAddress,
      operationId: source.operationId,
      attemptId: source.attemptId,
      operationType: "join",
      signerRole: "piotr-manual",
      chainId: source.chainId,
      contractAddress: source.contractAddress,
      tokenAddress: source.tokenAddress,
      target: source.target,
      valueWei: source.valueWei,
      calldataDigest: source.calldataDigest,
      beforeStateDigest: source.beforeStateDigest,
      timestamp: at(1),
    }), /outside every automatic protocol/);
  });
});

describe("exact-99 fixture nonce manager and fee guard", function () {
  it("reserves the next nonce only when latest and pending agree", function () {
    const result = inspectExact99FixtureNonce({
      signerRole: "participant",
      signerAddress: WALLET,
      latestNonce: 7,
      pendingNonce: 7,
      journalExpectedNonce: 7,
      knownTransactions: [],
    });
    assert.equal(result.allowed, true);
    assert.equal(result.nonce, 7);
  });

  it("waits for a single pending transaction that exactly matches the journal", function () {
    const result = inspectExact99FixtureNonce({
      signerRole: "participant",
      signerAddress: WALLET,
      latestNonce: 7,
      pendingNonce: 8,
      journalExpectedNonce: 7,
      knownTransactions: [{
        attemptId: ATTEMPT_ID,
        nonce: 7,
        transactionHash: TX_HASH,
        source: "journal",
        state: "pending",
        replacementOfAttemptId: null,
      }],
    });
    assert.equal(result.decision, "wait-known-pending");
    assert.equal(result.allowed, false);
  });

  it("blocks a manual transaction in the same signer nonce space", function () {
    const result = inspectExact99FixtureNonce({
      signerRole: "participant",
      signerAddress: WALLET,
      latestNonce: 7,
      pendingNonce: 8,
      journalExpectedNonce: null,
      knownTransactions: [{
        attemptId: null,
        nonce: 7,
        transactionHash: TX_HASH,
        source: "external",
        state: "pending",
        replacementOfAttemptId: null,
      }],
    });
    assert.equal(result.decision, "block-foreign-pending");
  });

  it("uses a separate mutex namespace for the funding signer role", function () {
    const participant = inspectExact99FixtureNonce({
      signerRole: "participant",
      signerAddress: WALLET,
      latestNonce: 0,
      pendingNonce: 0,
      journalExpectedNonce: null,
      knownTransactions: [],
    });
    const funding = inspectExact99FixtureNonce({
      signerRole: "funding",
      signerAddress: WALLET,
      latestNonce: 0,
      pendingNonce: 0,
      journalExpectedNonce: null,
      knownTransactions: [],
    });
    assert.notEqual(participant.mutexNamespace, funding.mutexNamespace);
  });

  const limits: Exact99FixtureFeeLimits = {
    fixtureOnly: true,
    profileName: "exact-99-fixture-fees",
    maxOperationGasLimit: "200000",
    maxEstimationMultiplierBps: 12500,
    maxFeePerGasWei: "100",
    maxPriorityFeePerGasWei: "20",
    maxOperationCostWei: "20000000",
    maxWalletCostWei: "40000000",
    maxCheckpointCostWei: "100000000",
    maxRunCostWei: "500000000",
    fundingSignerReserveWei: "100000000",
    participantReserveWei: "20000000",
    laterClaimReserveWei: "10000000",
  };

  function feeRequest() {
    return {
      signerRole: "participant" as const,
      estimationComplete: true,
      estimatedGasLimit: "100000",
      gasLimit: "120000",
      maxFeePerGasWei: "100",
      maxPriorityFeePerGasWei: "20",
      additionalLayerFeeCapWei: "0",
      walletSpentWei: "0",
      checkpointSpentWei: "0",
      runSpentWei: "0",
      walletBalanceWei: "50000000",
      signerBalanceWei: "200000000",
      requestedAutomaticCapIncrease: false,
    };
  }

  it("accepts complete fixture fee data inside every cap and reserve", function () {
    const result = evaluateExact99FixtureFeeGuard({ limits, request: feeRequest() });
    assert.equal(result.allowed, true);
    assert.equal(result.totalFeeCapWei, "12000000");
  });

  it("blocks incomplete estimation and returns no speculative total cap", function () {
    const result = evaluateExact99FixtureFeeGuard({
      limits,
      request: { ...feeRequest(), estimationComplete: false, estimatedGasLimit: null },
    });
    assert.equal(result.allowed, false);
    assert.equal(result.totalFeeCapWei, null);
  });

  it("blocks fee spikes, reserve violations and automatic cap increases", function () {
    const result = evaluateExact99FixtureFeeGuard({
      limits,
      request: {
        ...feeRequest(),
        maxFeePerGasWei: "101",
        walletBalanceWei: "30000000",
        signerBalanceWei: "100000000",
        requestedAutomaticCapIncrease: true,
      },
    });
    assert.equal(result.allowed, false);
    assert(result.blockers.some((blocker) => blocker.includes("Automatic")));
    assert(result.blockers.some((blocker) => blocker.includes("Max fee")));
    assert(result.blockers.some((blocker) => blocker.includes("reserve")));
  });
});

describe("exact-99 dual-source evidence, finality and recovery", function () {
  it("binds two independent fixture sources to the same exact block and manifest identity", function () {
    const result = evidence();
    assert.equal(result.sourceA.blockHash, result.sourceB.blockHash);
    assert.match(result.evidenceDigest, /^sha256:/);
  });

  it("stops when sources report different block hashes", function () {
    assert.throws(() => evidence({}, { blockHash: `0x${"99".repeat(32)}` }), /blockHash/);
  });

  it("stops when one source is missing", function () {
    assert.throws(() => buildExact99DualSourceEvidence({
      sourceA: snapshot(),
      sourceB: null,
      manifestIdentity: {
        chainId: "84532",
        contractCodeHash: DIGEST_A,
        tokenCodeHash: DIGEST_B,
        abiDigest: DIGEST_C,
        contractParametersDigest: MANIFEST_FINGERPRINT,
      },
    }), /Both fixture read sources/);
  });

  it("uses configurable confirmation and checkpoint-final thresholds", function () {
    const base = {
      policy: {
        fixtureOnly: true as const,
        requiredConfirmationDepth: 3,
        checkpointFinalConfirmationDepth: 6,
      },
      observation: {
        transactionHash: TRANSPORT_HASH,
        receiptFoundBySourceA: true,
        receiptFoundBySourceB: true,
        blockNumberBySourceA: 1_000,
        blockNumberBySourceB: 1_000,
        blockHashBySourceA: BLOCK_HASH,
        blockHashBySourceB: BLOCK_HASH,
        recordedBlockNumber: 1_000,
        recordedBlockHash: BLOCK_HASH,
        headBlockNumber: 1_002,
        semanticReconciliation: "matched" as const,
        checkpointRecheck: false,
      },
    };
    const confirmed = assessExact99FixtureFinality(base);
    assert.equal(confirmed.mayConfirm, true);
    assert.equal(confirmed.mayFinalizeCheckpoint, false);
    const finalized = assessExact99FixtureFinality({
      ...base,
      observation: { ...base.observation, headBlockNumber: 1_005, checkpointRecheck: true },
    });
    assert.equal(finalized.finalityState, "checkpoint-final");
  });

  it("detects receipt disappearance, movement and canonical hash changes as reorg evidence", function () {
    const common = {
      policy: {
        fixtureOnly: true as const,
        requiredConfirmationDepth: 2,
        checkpointFinalConfirmationDepth: 4,
      },
      observation: {
        transactionHash: TRANSPORT_HASH,
        receiptFoundBySourceA: true,
        receiptFoundBySourceB: true,
        blockNumberBySourceA: 1_000,
        blockNumberBySourceB: 1_000,
        blockHashBySourceA: BLOCK_HASH,
        blockHashBySourceB: BLOCK_HASH,
        recordedBlockNumber: 1_000,
        recordedBlockHash: BLOCK_HASH,
        headBlockNumber: 1_010,
        semanticReconciliation: "matched" as const,
        checkpointRecheck: true,
      },
    };
    assert.equal(assessExact99FixtureFinality({
      ...common,
      observation: { ...common.observation, receiptFoundBySourceB: false },
    }).reorgDetected, true);
    assert.equal(assessExact99FixtureFinality({
      ...common,
      observation: { ...common.observation, blockNumberBySourceB: 1_001 },
    }).reorgDetected, true);
    assert.equal(assessExact99FixtureFinality({
      ...common,
      observation: { ...common.observation, blockHashBySourceA: `0x${"99".repeat(32)}` },
    }).reorgDetected, true);
  });

  it("never treats absence in only one source as safe evidence for a new transaction", function () {
    assert.equal(inspectExact99Recovery({
      attempt: latest(journalAt("signed")),
      evidence: recoveryEvidence({
        transportLookup: "not-found-one-source",
        broadcastMayHaveOccurred: true,
      }),
    }), "ambiguous");
  });

  it("distinguishes safe signed rebroadcast, pending, mined, confirmed and checkpoint-final recovery", function () {
    assert.equal(inspectExact99Recovery({
      attempt: latest(journalAt("signed")),
      evidence: recoveryEvidence({ transportLookup: "not-found-two-sources" }),
    }), "safe-to-broadcast-signed-transaction");
    assert.equal(inspectExact99Recovery({
      attempt: latest(journalAt("pending")),
      evidence: recoveryEvidence({ transportLookup: "found-pending" }),
    }), "wait-pending");
    assert.equal(inspectExact99Recovery({
      attempt: latest(journalAt("pending")),
      evidence: recoveryEvidence({ transportLookup: "found-mined" }),
    }), "reconcile-mined");
    assert.equal(inspectExact99Recovery({
      attempt: latest(journalAt("confirmed")),
      evidence: recoveryEvidence({ finalityAssessment: finality({ mayConfirm: true }) }),
    }), "confirmed");
    assert.equal(inspectExact99Recovery({
      attempt: latest(journalAt("checkpoint-final")),
      evidence: recoveryEvidence({
        finalityAssessment: finality({
          finalityState: "checkpoint-final",
          mayConfirm: true,
          mayFinalizeCheckpoint: true,
        }),
      }),
    }), "checkpoint-final");
  });
});

describe("exact-99 global run lock fixture", function () {
  it("blocks a second process for the same set", function () {
    const registry = new FixtureExact99GlobalRunLockRegistry();
    registry.acquire(runLock());
    assert.throws(() => registry.acquire(runLock({
      runId: "77777777-7777-4777-8777-777777777777",
      pid: 5678,
    })), /already exists/);
  });

  it("does not auto-delete a stale lock and requires manual-review plus exact takeover authorization", function () {
    const registry = new FixtureExact99GlobalRunLockRegistry();
    registry.acquire(runLock());
    registry.markStaleForManualReview(SET_ID, "Fixture PID is absent; artifacts require inspection.");
    assert.throws(() => registry.takeOver({
      setId: SET_ID,
      authorizationPhrase: "no",
      replacement: runLock({ runId: "77777777-7777-4777-8777-777777777777" }),
    }), /explicit authorization/);
    const taken = registry.takeOver({
      setId: SET_ID,
      authorizationPhrase: EXACT_99_STALE_LOCK_TAKEOVER_AUTHORIZATION,
      replacement: runLock({ runId: "77777777-7777-4777-8777-777777777777" }),
    });
    assert.equal(taken.runId, "77777777-7777-4777-8777-777777777777");
  });

  it("stops on journal revision conflict before lock update or release", function () {
    const registry = new FixtureExact99GlobalRunLockRegistry();
    registry.acquire(runLock());
    assert.throws(() => registry.update({
      setId: SET_ID,
      runId: RUN_ID,
      expectedJournalRevision: 9,
      nextJournalChecksum: DIGEST_A,
      nextJournalRevision: 10,
      checkpoint: "checkpoint-5",
      signerRole: "participant",
      walletIndex: 0,
      operationId: OPERATION_ID,
    }), /revision conflict/);
    assert.throws(() => registry.release({
      setId: SET_ID,
      runId: RUN_ID,
      expectedJournalChecksum: DIGEST_A,
      expectedJournalRevision: 0,
    }), /Artifact revision conflict/);
  });

  for (const point of [
    "before-lock-acquire",
    "after-lock-acquire",
    "before-lock-update",
    "after-lock-update",
    "before-lock-release",
    "after-lock-release",
  ] as const) {
    it(`fault injection at ${point} leaves a deterministic lock state`, function () {
      const registry = new FixtureExact99GlobalRunLockRegistry();
      const hook = (observed: string) => {
        if (observed === point) throw new Error(`fixture crash at ${point}`);
      };
      if (point === "before-lock-acquire" || point === "after-lock-acquire") {
        assert.throws(() => registry.acquire(runLock(), hook), /fixture crash/);
        assert.equal(registry.inspect(SET_ID) !== null, point === "after-lock-acquire");
        return;
      }
      registry.acquire(runLock());
      if (point === "before-lock-update" || point === "after-lock-update") {
        assert.throws(() => registry.update({
          setId: SET_ID,
          runId: RUN_ID,
          expectedJournalRevision: 0,
          nextJournalChecksum: DIGEST_A,
          nextJournalRevision: 1,
          checkpoint: "checkpoint-5",
          signerRole: "participant",
          walletIndex: 0,
          operationId: OPERATION_ID,
          hook,
        }), /fixture crash/);
        assert.equal(registry.inspect(SET_ID)?.journalRevision,
          point === "after-lock-update" ? 1 : 0);
        return;
      }
      assert.throws(() => registry.release({
        setId: SET_ID,
        runId: RUN_ID,
        expectedJournalChecksum: emptyJournal().checksum,
        expectedJournalRevision: 0,
        hook,
      }), /fixture crash/);
      assert.equal(registry.inspect(SET_ID) !== null, point === "before-lock-release");
    });
  }
});

describe("exact-99 boundary-99 fixture", function () {
  function boundaryInput() {
    const sameEvidence = evidence();
    return {
      authorizationPhrase: EXACT_99_BOUNDARY_AUTHORIZATION,
      threatAcknowledgment: EXACT_99_BOUNDARY_THREAT_ACKNOWLEDGMENT,
      walletIndex: 98,
      activePositionCount: 98,
      expectedPoolAmount: "3234000000",
      observedPoolAmount: "3234000000",
      poolStatus: "Open" as const,
      lockedAt: "0",
      escrowExpected: "3234000000",
      escrowObserved: "3234000000",
      foreignEventSinceCheckpoint: false,
      piotrWalletReady: true,
      participantNonceDecision: freeNonce(),
      pendingTransaction: false,
      snapshotId: "fixture-boundary-snapshot-1",
      snapshotCreatedAt: CREATED_AT,
      evaluatedAt: at(30),
      maximumSnapshotAgeSeconds: 60,
      previouslyUsedSnapshotIds: [] as string[],
      beforeEvidence: sameEvidence,
      afterEvidence: structuredClone(sameEvidence),
    };
  }

  it("allows only index 98 after all threat gates and transitions to awaiting-manual-100", function () {
    const result = evaluateExact99Boundary99(boundaryInput());
    assert.equal(result.allowed, true);
    assert.equal(result.nextStage, "awaiting-manual-100");
    assert.match(result.oneUseSnapshotDigest!, /^sha256:/);
  });

  it("rejects index 99 completely", function () {
    const result = evaluateExact99Boundary99({ ...boundaryInput(), walletIndex: 99 });
    assert.equal(result.allowed, false);
    assert(result.blockers.some((blocker) => blocker.includes("Index 99")));
  });

  it("blocks a reused or stale boundary snapshot", function () {
    const reused = evaluateExact99Boundary99({
      ...boundaryInput(),
      previouslyUsedSnapshotIds: ["fixture-boundary-snapshot-1"],
    });
    assert.equal(reused.allowed, false);
    const stale = evaluateExact99Boundary99({
      ...boundaryInput(),
      evaluatedAt: at(120),
    });
    assert.equal(stale.allowed, false);
  });
});

describe("exact-99 required fault-injection recovery matrix", function () {
  const safeFaults = [
    {
      name: "before prepared",
      attempt: () => latest(journalAt("planned")),
      evidence: () => recoveryEvidence(),
      expected: "safe-to-prepare",
    },
    {
      name: "after prepared",
      attempt: () => latest(journalAt("prepared")),
      evidence: () => recoveryEvidence(),
      expected: "safe-to-prepare",
    },
    {
      name: "after nonce reservation",
      attempt: () => latest(journalAt("nonce-reserved")),
      evidence: () => recoveryEvidence(),
      expected: "manual-review",
    },
    {
      name: "before simulated signing",
      attempt: () => latest(journalAt("nonce-reserved")),
      evidence: () => recoveryEvidence(),
      expected: "manual-review",
    },
    {
      name: "after signing before signed hash persistence",
      attempt: () => latest(journalAt("nonce-reserved")),
      evidence: () => recoveryEvidence({ broadcastMayHaveOccurred: false }),
      expected: "manual-review",
    },
    {
      name: "after signed hash persistence before broadcast",
      attempt: () => latest(journalAt("signed")),
      evidence: () => recoveryEvidence({ transportLookup: "not-found-two-sources" }),
      expected: "safe-to-broadcast-signed-transaction",
    },
    {
      name: "during broadcast without response",
      attempt: () => latest(journalAt("signed")),
      evidence: () => recoveryEvidence({
        transportLookup: "not-found-one-source",
        broadcastMayHaveOccurred: true,
      }),
      expected: "ambiguous",
    },
    {
      name: "after broadcast returned a hash",
      attempt: () => latest(journalAt("broadcast-attempted")),
      evidence: () => recoveryEvidence({ transportLookup: "found-pending" }),
      expected: "wait-pending",
    },
    {
      name: "after receipt before mined persistence",
      attempt: () => latest(journalAt("pending")),
      evidence: () => recoveryEvidence({ transportLookup: "found-mined", receiptStatus: 1 }),
      expected: "reconcile-mined",
    },
    {
      name: "after mined before reconciliation",
      attempt: () => latest(journalAt("mined")),
      evidence: () => recoveryEvidence({ receiptStatus: 1 }),
      expected: "reconcile-mined",
    },
    {
      name: "after reconciliation before confirmed",
      attempt: () => latest(journalAt("reconciling")),
      evidence: () => recoveryEvidence({
        receiptStatus: 1,
        semanticReconciliation: "matched",
        finalityAssessment: finality(),
      }),
      expected: "wait-confirmations",
    },
    {
      name: "after confirmed before checkpoint",
      attempt: () => latest(journalAt("confirmed")),
      evidence: () => recoveryEvidence({
        receiptStatus: 1,
        semanticReconciliation: "matched",
        finalityAssessment: finality({ mayConfirm: true, finalityState: "confirmed" }),
      }),
      expected: "confirmed",
    },
  ] as const;

  for (const fault of safeFaults) {
    it(`${fault.name} produces ${fault.expected} without a new automatic attempt`, function () {
      const decision = inspectExact99Recovery({
        attempt: fault.attempt(),
        evidence: fault.evidence(),
      });
      assert.equal(decision, fault.expected);
      if (fault.expected !== "safe-to-prepare") {
        assert.notEqual(decision, "safe-to-prepare");
      }
    });
  }

  it("a corrupted journal body is rejected before recovery", function () {
    const journal = structuredClone(journalAt("signed"));
    journal.entries[0].walletIndex = 1;
    assert.throws(() => validateExact99JournalV2(journal), /checksum mismatch/);
  });

  it("an explicitly wrong journal checksum is rejected", function () {
    const journal = structuredClone(journalAt("signed"));
    journal.checksum = DIGEST_A;
    assert.throws(() => validateExact99JournalV2(journal), /checksum mismatch/);
  });

  it("replacement enters investigate-replacement and never creates another automatic attempt", function () {
    const journal = transitionExact99Attempt(journalAt("pending"), ATTEMPT_ID, "replaced", {
      manualReviewReason: "Fixture replacement transaction observed.",
      recoveryStatus: "manual-review",
    }, at(40));
    assert.equal(inspectExact99Recovery({
      attempt: latest(journal),
      evidence: recoveryEvidence(),
    }), "investigate-replacement");
  });

  it("cancellation enters investigate-cancellation and never reuses the nonce", function () {
    const journal = transitionExact99Attempt(journalAt("pending"), ATTEMPT_ID, "cancelled", {
      manualReviewReason: "Fixture cancellation observed.",
      recoveryStatus: "manual-review",
    }, at(40));
    assert.equal(inspectExact99Recovery({
      attempt: latest(journal),
      evidence: recoveryEvidence(),
    }), "investigate-cancellation");
  });

  it("reorg after confirmed enters investigate-reorg and blocks checkpoint progress", function () {
    const journal = transitionExact99Attempt(journalAt("confirmed"), ATTEMPT_ID, "reorged", {
      finalityState: "reorged",
      manualReviewReason: "Fixture canonical block changed.",
      recoveryStatus: "manual-review",
    }, at(40));
    assert.equal(inspectExact99Recovery({
      attempt: latest(journal),
      evidence: recoveryEvidence({
        finalityAssessment: finality({ reorgDetected: true, finalityState: "reorged" }),
      }),
    }), "investigate-reorg");
  });

  it("an external join before boundary-99 blocks the boundary attempt", function () {
    const sameEvidence = evidence();
    const result = evaluateExact99Boundary99({
      authorizationPhrase: EXACT_99_BOUNDARY_AUTHORIZATION,
      threatAcknowledgment: EXACT_99_BOUNDARY_THREAT_ACKNOWLEDGMENT,
      walletIndex: 98,
      activePositionCount: 98,
      expectedPoolAmount: "1",
      observedPoolAmount: "1",
      poolStatus: "Open",
      lockedAt: "0",
      escrowExpected: "1",
      escrowObserved: "1",
      foreignEventSinceCheckpoint: true,
      piotrWalletReady: true,
      participantNonceDecision: freeNonce(),
      pendingTransaction: false,
      snapshotId: "fixture-boundary-external-before",
      snapshotCreatedAt: CREATED_AT,
      evaluatedAt: at(1),
      maximumSnapshotAgeSeconds: 60,
      previouslyUsedSnapshotIds: [],
      beforeEvidence: sameEvidence,
      afterEvidence: structuredClone(sameEvidence),
    });
    assert.equal(result.allowed, false);
  });

  it("an external join between boundary snapshots blocks the boundary attempt", function () {
    const before = evidence();
    const after = evidence(
      { operationStateDigest: exact99FixtureDigest({ positions: 99 }) },
      { operationStateDigest: exact99FixtureDigest({ positions: 99 }) },
    );
    const result = evaluateExact99Boundary99({
      authorizationPhrase: EXACT_99_BOUNDARY_AUTHORIZATION,
      threatAcknowledgment: EXACT_99_BOUNDARY_THREAT_ACKNOWLEDGMENT,
      walletIndex: 98,
      activePositionCount: 98,
      expectedPoolAmount: "1",
      observedPoolAmount: "1",
      poolStatus: "Open",
      lockedAt: "0",
      escrowExpected: "1",
      escrowObserved: "1",
      foreignEventSinceCheckpoint: false,
      piotrWalletReady: true,
      participantNonceDecision: freeNonce(),
      pendingTransaction: false,
      snapshotId: "fixture-boundary-external-between",
      snapshotCreatedAt: CREATED_AT,
      evaluatedAt: at(1),
      maximumSnapshotAgeSeconds: 60,
      previouslyUsedSnapshotIds: [],
      beforeEvidence: before,
      afterEvidence: after,
    });
    assert.equal(result.allowed, false);
    assert(result.blockers.some((blocker) => blocker.includes("changed")));
  });

  it("the declared fault-point catalog covers all important lock and transaction persistence windows", function () {
    assert(EXACT_99_PROTOCOL_FAULT_POINTS.includes("before-prepared"));
    assert(EXACT_99_PROTOCOL_FAULT_POINTS.includes("after-simulated-sign-before-signed-persist"));
    assert(EXACT_99_PROTOCOL_FAULT_POINTS.includes("during-broadcast-no-response"));
    assert(EXACT_99_PROTOCOL_FAULT_POINTS.includes("after-confirmed-before-checkpoint"));
    assert(EXACT_99_PROTOCOL_FAULT_POINTS.includes("before-lock-release"));
  });
});
