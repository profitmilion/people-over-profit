import { getAddress } from "viem";

import {
  GUARDED_CHECKPOINT_20_BATCH_TARGETS,
  GUARDED_CHECKPOINT_20_CANDIDATE_COUNT,
  GUARDED_CHECKPOINT_20_FUNDING_LIMITS,
  GUARDED_CHECKPOINT_20_STEPS,
  assertGuardedCheckpoint20Mode,
  buildEmptyGuardedCheckpoint20Journal,
  buildGuardedCheckpoint20Manifest,
  inspectGuardedCheckpoint20Progress,
  renderGuardedCheckpoint20Inspection,
  simulateGuardedCheckpoint20Batch,
  type GuardedCheckpoint20Mode,
} from "./operator/guarded-checkpoint-20.js";
import {
  inspectGuardedCheckpoint20BaseSepolia,
  renderGuardedCheckpoint20BaseSepoliaInspection,
} from "./operator/guarded-checkpoint-20-base-sepolia.js";
import { sanitizeOperatorError } from "./operator/transaction-journal.js";

function fixtureManifest() {
  return buildGuardedCheckpoint20Manifest({
    addresses: Array.from({ length: 15 }, (_, index) =>
      getAddress(`0x${(index + 1_000).toString(16).padStart(40, "0")}`)),
    storeBinding: {
      formatVersion: 2,
      storeId: "20202020-2020-4020-8020-202020202020",
      publicFingerprint: `sha256:${"2".repeat(64)}`,
      selectedRecordDecryption: true,
      externalPathRequired: true,
    },
  });
}

function plan() {
  return {
    mode: "plan",
    readOnly: true,
    executionAvailable: false,
    baselineCount: 5,
    targetCount: 20,
    candidateCount: GUARDED_CHECKPOINT_20_CANDIDATE_COUNT,
    batchTargets: GUARDED_CHECKPOINT_20_BATCH_TARGETS,
    candidateSteps: GUARDED_CHECKPOINT_20_STEPS,
    fundingLimits: GUARDED_CHECKPOINT_20_FUNDING_LIMITS,
    storeRequirement: "external selected-record v2; public manifest only; not created by this command",
    safety: "PLAN ONLY — EXECUTE IS NOT IMPLEMENTED OR AUTHORIZED",
  };
}

async function main(): Promise<void> {
  const rawMode = process.env.POP33_CHECKPOINT_20_MODE?.trim() ?? "plan";
  assertGuardedCheckpoint20Mode(rawMode);
  const mode: GuardedCheckpoint20Mode = rawMode;
  const format = process.env.POP33_CHECKPOINT_20_FORMAT?.trim() ?? "text";
  if (format !== "text" && format !== "json") throw new Error("Format must be text or json.");
  if (mode === "plan") {
    const output = plan();
    console.log(format === "json" ? JSON.stringify(output, null, 2) : [
      "POP33 guarded checkpoint-20 plan",
      "Baseline: 5/100",
      "Target: 20/100",
      "Candidates: indices 0-14",
      "Batch hard stops: 10/100, 15/100, 20/100",
      "Funding cap: 0.00005 ETH per candidate; 0.00075 ETH total",
      "External selected-record store v2 and public manifest are required later.",
      "EXECUTE IS NOT IMPLEMENTED OR AUTHORIZED.",
    ].join("\n"));
    return;
  }
  if (mode === "inspect") {
    const report = await inspectGuardedCheckpoint20BaseSepolia({
      candidateAddress: process.env.POP33_CHECKPOINT_20_CANDIDATE?.trim() || undefined,
    });
    console.log(format === "json"
      ? JSON.stringify(report, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)
      : renderGuardedCheckpoint20BaseSepoliaInspection(report));
    if (report.hardStops.length > 0) process.exitCode = 11;
    return;
  }
  const manifest = fixtureManifest();
  let journal = buildEmptyGuardedCheckpoint20Journal(manifest);
  const stops: number[] = [];
  for (let batch = 0; batch < 3; batch += 1) {
    const result = simulateGuardedCheckpoint20Batch({ manifest, journal });
    journal = result.journal;
    if (result.stoppedAtBatch !== null) stops.push(result.stoppedAtBatch);
    if (result.stoppedOnFault) throw new Error(result.inspection.blockers[0] ?? "Fixture simulation stopped.");
  }
  const inspection = inspectGuardedCheckpoint20Progress(journal, manifest);
  const output = {
    mode: "simulate",
    fixtureOnly: true,
    stops,
    processedCandidates: inspection.completedCandidates,
    finalCount: inspection.expectedCount,
    finalEscrow: inspection.expectedEscrow,
    hardStopReached: inspection.hardStopReached,
    transactionTransportPresent: false,
  };
  console.log(format === "json" ? JSON.stringify(output, null, 2) : [
    renderGuardedCheckpoint20Inspection(inspection),
    `Observed batch stops: ${stops.join(", ")}`,
    "Fixture simulation only; no provider, signer, wallet, or transaction transport was used.",
  ].join("\n"));
}

void main().catch((error: unknown) => {
  console.error(`Guarded checkpoint-20 stopped: ${sanitizeOperatorError(error)}`);
  console.error("No key or transaction path was loaded. 0 transactions sent.");
  process.exitCode = 1;
});
