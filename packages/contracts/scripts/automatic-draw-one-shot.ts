import { getAddress, isAddress, type Address } from "viem";

import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
  DEMO_V1_TOKEN_ADDRESS,
} from "../../../src/demo-v1/safety.js";
import {
  PILOT_10_APPROVED_OPERATOR,
  executeAutomaticDrawOneShot,
  type AutomaticDrawOneShotExecutionDependencies,
  type AutomaticDrawOneShotExecutionOptions,
  type AutomaticDrawOneShotExecutionResult,
} from "./operator/automatic-draw-runner-v1-execution.js";
import { logicalDrawKey } from "./operator/automatic-draw-runner-v1-decision.js";
import { handoffAutomaticDrawExecutionIntent } from "./operator/automatic-draw-runner-v1-handoff.js";
import {
  runAutomaticDrawDryRun,
} from "./operator/automatic-draw-runner-v1-preflight.js";
import {
  runAutomaticDrawProgressionCycle,
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawStoredOperation,
} from "./operator/automatic-draw-runner-v1-progression.js";
import {
  authorizeAutomaticDrawExecutionReadiness,
  type AutomaticDrawExecutionReadinessDependencies,
  type AutomaticDrawExecutionReadinessResult,
} from "./operator/automatic-draw-runner-v1-readiness.js";
import { runAutomaticDrawReservationCycle } from "./operator/automatic-draw-runner-v1-reservation.js";
import {
  readAutomaticDrawDurableRuntimeConfig,
  type AutomaticDrawDurableRuntimeOptions,
} from "./operator/automatic-draw-runner-v1-runtime.js";
import { JsonAutomaticDrawReservationStore } from "./operator/automatic-draw-runner-v1-state.js";
import {
  createBaseSepoliaGuardedDrawDependencies,
} from "./operator/guarded-single-draw-base-sepolia.js";
import { sanitizeGuardedDrawError } from "./operator/guarded-single-draw.js";
import {
  createLifecycleActionPlan,
  parseLifecycleActionPlanJson,
  serializeLifecycleActionPlan,
  type LifecycleActionPlan,
} from "./operator/lifecycle-action-plan.js";
import {
  readLifecyclePlanFile,
  resolveLifecyclePlanPath,
  writeLifecyclePlanFile,
} from "./operator/lifecycle-plan-file.js";
import {
  LIFECYCLE_SUPERVISOR_DEFAULT_RPC_URL,
  LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  validateLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorTimeout,
} from "./operator/lifecycle-supervisor-base-sepolia.js";
import { analyzeLifecycleSnapshot } from "./operator/lifecycle-supervisor.js";
import { pathIsRegularFile } from "./operator/durable-file.js";
import {
  JsonTransactionJournal,
  readJournalPathFromEnvironment,
  type JournalIdentity,
} from "./operator/transaction-journal.js";

export const AUTOMATIC_DRAW_ONE_SHOT_MODES = [
  "prepare",
  "execute-once",
] as const;
export type AutomaticDrawOneShotMode =
  (typeof AUTOMATIC_DRAW_ONE_SHOT_MODES)[number];

const MODE_ENV = "POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_MODE";
const POOL_ENV = "POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_POOL";
const PLAN_ENV = "POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_PLAN";
const CONFIRM_CHAIN_ENV =
  "POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_CONFIRM_CHAIN";
const CONFIRM_CONTRACT_ENV =
  "POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_CONFIRM_CONTRACT";
const CONFIRM_POOL_ENV =
  "POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_CONFIRM_POOL";
const CONFIRM_ROUND_ENV =
  "POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_CONFIRM_ROUND";
const INVOKE_ENV = "POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_INVOKE";
const CUTOVER_ENV = "POP33_AUTOMATIC_DRAW_LIVE_TEST_ACTIVE";

const journalIdentity: JournalIdentity = {
  chainId: BigInt(DEMO_V1_CHAIN_ID),
  contractAddress: DEMO_V1_CONTRACT_ADDRESS,
  tokenAddress: DEMO_V1_TOKEN_ADDRESS,
};

export interface AutomaticDrawActivationConfirmation {
  chainId: string;
  contractAddress: string;
  poolId: string;
  roundNumber: string;
}

export interface AutomaticDrawActivationRequest {
  mode: string;
  poolId?: bigint;
  planPath: string;
  confirmation?: AutomaticDrawActivationConfirmation;
}

export interface AutomaticDrawActivationPublicResult {
  mode: AutomaticDrawOneShotMode;
  status: "READY" | "CONFIRMED" | "REVERTED" | "RECONCILIATION_REQUIRED";
  exitCode: number;
  chainId: string;
  contractAddress: Address;
  tokenAddress: Address;
  operatorAddress: Address;
  poolId: string;
  roundNumber: string;
  logicalDrawKey: string;
  planId: string;
  progressionRevision: number;
  journalRevision: number;
  journalOperationId: string;
  journalStatus: string;
  readinessStatus: string;
  executionStatus: string | null;
  transactionHash: string | null;
  reason: string;
}

export interface PrepareAutomaticDrawActivationInput {
  poolId: bigint;
  planPath: string;
  automaticDrawStatePath: string;
  transactionJournalPath: string;
  operatorAddress: string;
  dependencies: AutomaticDrawExecutionReadinessDependencies;
  maxPlanAgeSeconds?: bigint;
  workingDirectory?: string;
}

export interface ExecuteAutomaticDrawActivationInput {
  planPath: string;
  durable: AutomaticDrawDurableRuntimeOptions;
  operatorAddress: string;
  confirmation: AutomaticDrawActivationConfirmation;
  dependencies: AutomaticDrawOneShotExecutionDependencies;
  maxPlanAgeSeconds?: bigint;
  coordinator?: (
    options: AutomaticDrawOneShotExecutionOptions,
  ) => Promise<AutomaticDrawOneShotExecutionResult>;
  workingDirectory?: string;
}

export interface AutomaticDrawActivationServices {
  prepare(request: AutomaticDrawActivationRequest): Promise<AutomaticDrawActivationPublicResult>;
  executeOnce(request: AutomaticDrawActivationRequest): Promise<AutomaticDrawActivationPublicResult>;
}

function requireApprovedOperator(value: string): Address {
  if (!isAddress(value) || getAddress(value) !== PILOT_10_APPROVED_OPERATOR) {
    throw new Error("The public operator is not the approved Pilot 10 operator.");
  }
  return PILOT_10_APPROVED_OPERATOR;
}

function requirePositiveBigInt(name: string, value: string | undefined): bigint {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return BigInt(value);
}

function readOptionalUnsignedBigInt(
  name: string,
  value: string | undefined,
): bigint | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be an unsigned integer.`);
  }
  return BigInt(trimmed);
}

function requireEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requireDrawPlan(json: string): LifecycleActionPlan {
  const parsed = parseLifecycleActionPlanJson(json);
  if (
    !parsed.ok ||
    parsed.plan.identity.chainId !== BigInt(DEMO_V1_CHAIN_ID).toString() ||
    getAddress(parsed.plan.identity.contractAddress) !==
      DEMO_V1_CONTRACT_ADDRESS ||
    parsed.plan.scope.plannedAction !== "DRAW" ||
    parsed.plan.scope.roundNumber === null
  ) {
    throw new Error(
      "The activation plan is not one canonical Base Sepolia Pilot Draw.",
    );
  }
  return parsed.plan;
}

function requireExactConfirmation(
  plan: LifecycleActionPlan,
  confirmation: AutomaticDrawActivationConfirmation,
): void {
  if (
    confirmation.chainId !== BigInt(DEMO_V1_CHAIN_ID).toString() ||
    !isAddress(confirmation.contractAddress) ||
    getAddress(confirmation.contractAddress) !== DEMO_V1_CONTRACT_ADDRESS ||
    confirmation.poolId !== plan.scope.poolId ||
    confirmation.roundNumber !== plan.scope.roundNumber
  ) {
    throw new Error(
      "Exact chain, contract, pool, and round confirmation does not match the prepared Draw.",
    );
  }
}

function publicResult(input: {
  mode: AutomaticDrawOneShotMode;
  status: AutomaticDrawActivationPublicResult["status"];
  exitCode: number;
  operatorAddress: Address;
  plan: LifecycleActionPlan;
  logicalDrawKey: string;
  progression: AutomaticDrawStoredOperation;
  journalRevision: number;
  journalOperationId: string;
  journalStatus: string;
  readiness: AutomaticDrawExecutionReadinessResult;
  execution?: AutomaticDrawOneShotExecutionResult;
  reason: string;
}): AutomaticDrawActivationPublicResult {
  return {
    mode: input.mode,
    status: input.status,
    exitCode: input.exitCode,
    chainId: BigInt(DEMO_V1_CHAIN_ID).toString(),
    contractAddress: DEMO_V1_CONTRACT_ADDRESS,
    tokenAddress: DEMO_V1_TOKEN_ADDRESS,
    operatorAddress: input.operatorAddress,
    poolId: input.plan.scope.poolId,
    roundNumber: input.plan.scope.roundNumber as string,
    logicalDrawKey: input.logicalDrawKey,
    planId: input.plan.planId,
    progressionRevision: input.progression.revision,
    journalRevision: input.journalRevision,
    journalOperationId: input.journalOperationId,
    journalStatus: input.journalStatus,
    readinessStatus: input.readiness.status,
    executionStatus: input.execution?.status ?? null,
    transactionHash: input.execution?.journalOperation?.transactionHash ?? null,
    reason: sanitizeGuardedDrawError(input.reason),
  };
}

async function persistOrVerifyPlan(
  planPath: string,
  plan: LifecycleActionPlan,
  workingDirectory?: string,
): Promise<string> {
  const path = resolveLifecyclePlanPath(
    planPath,
    workingDirectory ?? process.cwd(),
  );
  if (await pathIsRegularFile(path)) {
    const existing = await readLifecyclePlanFile(path);
    const parsed = requireDrawPlan(existing.json);
    if (parsed.planId !== plan.planId || parsed.fingerprint !== plan.fingerprint) {
      throw new Error("Existing lifecycle plan does not match durable preflight.");
    }
    return existing.json;
  }
  await writeLifecyclePlanFile(path, plan);
  return serializeLifecycleActionPlan(plan);
}

export async function prepareAutomaticDrawActivation(
  input: PrepareAutomaticDrawActivationInput,
): Promise<AutomaticDrawActivationPublicResult> {
  if (input.poolId <= 0n) throw new Error("Pool ID must be positive.");
  const operatorAddress = requireApprovedOperator(input.operatorAddress);
  const store = new JsonAutomaticDrawReservationStore(
    input.automaticDrawStatePath,
  );
  const journal = await JsonTransactionJournal.open(
    input.transactionJournalPath,
    journalIdentity,
  );
  const reservation = await runAutomaticDrawReservationCycle({
    scope: {
      chainId: BigInt(DEMO_V1_CHAIN_ID),
      contractAddress: DEMO_V1_CONTRACT_ADDRESS,
      poolId: input.poolId,
    },
    adapter: {
      source: "base-sepolia-read-only",
      readSnapshot: () => input.dependencies.readSnapshot(),
    },
    storage: store,
  });
  if (
    reservation.status === "NO_RESERVATION" ||
    reservation.status === "RECONCILIATION_REQUIRED"
  ) {
    throw new Error(
      `Automatic Draw reservation did not become ready: ${reservation.reason}`,
    );
  }
  const progressionResult = await runAutomaticDrawProgressionCycle({
    reservation,
    storage: store,
    runDryRun: runAutomaticDrawDryRun,
    operatorAddress,
    dependencies: input.dependencies,
    ...(input.maxPlanAgeSeconds === undefined
      ? {}
      : { maxPlanAgeSeconds: input.maxPlanAgeSeconds }),
  });
  if (
    progressionResult.status !== "PREFLIGHT_READY" ||
    !progressionResult.operation
  ) {
    throw new Error(
      `Automatic Draw progression did not become PREFLIGHT_READY: ${progressionResult.reason}`,
    );
  }
  const progression = progressionResult.operation;
  if (progression.progression.state !== "PREFLIGHT_READY") {
    throw new Error("Automatic Draw progression is not PREFLIGHT_READY.");
  }
  const sourceSnapshot = await input.dependencies.readSnapshot(
    BigInt(progression.record.sourceBlock),
  );
  const plan = createLifecycleActionPlan(
    sourceSnapshot,
    analyzeLifecycleSnapshot(sourceSnapshot),
    input.poolId,
    { sourceReference: "base-sepolia-read-only" },
  );
  if (plan.planId !== progression.progression.preflight.planId) {
    throw new Error("Persisted preflight and reconstructed lifecycle plan differ.");
  }
  const planJson = await persistOrVerifyPlan(
    input.planPath,
    plan,
    input.workingDirectory,
  );
  const handoff = await handoffAutomaticDrawExecutionIntent({
    logicalDrawKey: progression.record.logicalDrawKey,
    expectedProgressionRevision: progression.revision,
    progressionStorage: store,
    journal,
  });
  if (
    (handoff.status !== "HANDOFF_READY" && handoff.status !== "EXISTING") ||
    !handoff.journalOperation ||
    handoff.journalOperation.status !== "prepared"
  ) {
    throw new Error(`Automatic Draw journal handoff stopped: ${handoff.reason}`);
  }
  const durable: AutomaticDrawDurableRuntimeOptions = {
    automaticDrawStatePath: input.automaticDrawStatePath,
    transactionJournalPath: input.transactionJournalPath,
    journalIdentity,
    expectedProgressionRevision: progression.revision,
    expectedJournalRevision: journal.snapshot().revision,
    logicalDrawKey: progression.record.logicalDrawKey,
  };
  const readiness = await authorizeAutomaticDrawExecutionReadiness({
    durable,
    planJson,
    operatorAddress,
    dependencies: input.dependencies,
    ...(input.maxPlanAgeSeconds === undefined
      ? {}
      : { maxPlanAgeSeconds: input.maxPlanAgeSeconds }),
  });
  return publicResult({
    mode: "prepare",
    status: readiness.status === "READY_TO_LOAD_SIGNER"
      ? "READY"
      : "RECONCILIATION_REQUIRED",
    exitCode: readiness.status === "READY_TO_LOAD_SIGNER" ? 0 : 1,
    operatorAddress,
    plan,
    logicalDrawKey: progression.record.logicalDrawKey,
    progression,
    journalRevision: journal.snapshot().revision,
    journalOperationId: handoff.journalOperation.operationId,
    journalStatus: handoff.journalOperation.status,
    readiness,
    reason: readiness.reason,
  });
}

export async function executeAutomaticDrawActivationOnce(
  input: ExecuteAutomaticDrawActivationInput,
): Promise<AutomaticDrawActivationPublicResult> {
  const operatorAddress = requireApprovedOperator(input.operatorAddress);
  const planFile = await readLifecyclePlanFile(
    input.planPath,
    input.workingDirectory ?? process.cwd(),
  );
  const plan = requireDrawPlan(planFile.json);
  requireExactConfirmation(plan, input.confirmation);
  const poolId = BigInt(plan.scope.poolId);
  const roundNumber = BigInt(plan.scope.roundNumber as string);
  const key = logicalDrawKey({
    chainId: BigInt(DEMO_V1_CHAIN_ID),
    contractAddress: DEMO_V1_CONTRACT_ADDRESS,
    poolId,
    roundNumber,
  });
  if (input.durable.logicalDrawKey !== key) {
    throw new Error("Prepared logical Draw key does not match the confirmed target.");
  }
  const readiness = await authorizeAutomaticDrawExecutionReadiness({
    durable: input.durable,
    planJson: planFile.json,
    operatorAddress,
    dependencies: input.dependencies,
    ...(input.maxPlanAgeSeconds === undefined
      ? {}
      : { maxPlanAgeSeconds: input.maxPlanAgeSeconds }),
  });
  const inspected = await new JsonAutomaticDrawReservationStore(
    input.durable.automaticDrawStatePath,
  ).read(key);
  if (inspected.status !== "FOUND") {
    throw new Error("Prepared Automatic Draw progression is unavailable.");
  }
  const progression = validateAutomaticDrawStoredOperation(inspected.operation);
  const journal = await JsonTransactionJournal.openExisting(
    input.durable.transactionJournalPath,
    input.durable.journalIdentity,
  );
  const operationId = readiness.evidence.journalOperationId ?? "";
  const operation = operationId ? journal.find(operationId) : undefined;
  if (
    readiness.status !== "READY_TO_LOAD_SIGNER" ||
    !readiness.readyToLoadSigner ||
    !operation ||
    operation.status !== "prepared"
  ) {
    return publicResult({
      mode: "execute-once",
      status: "RECONCILIATION_REQUIRED",
      exitCode: 1,
      operatorAddress,
      plan,
      logicalDrawKey: key,
      progression,
      journalRevision: journal.snapshot().revision,
      journalOperationId: operation?.operationId ?? operationId,
      journalStatus: operation?.status ?? "missing",
      readiness,
      reason: readiness.reason,
    });
  }
  const coordinator = input.coordinator ?? executeAutomaticDrawOneShot;
  const execution = await coordinator({
    readiness,
    durable: input.durable,
    planJson: planFile.json,
    operatorAddress,
    dependencies: input.dependencies,
    ...(input.maxPlanAgeSeconds === undefined
      ? {}
      : { maxPlanAgeSeconds: input.maxPlanAgeSeconds }),
  });
  return publicResult({
    mode: "execute-once",
    status: execution.status,
    exitCode: execution.status === "CONFIRMED"
      ? 0
      : execution.status === "REVERTED"
        ? 3
        : 4,
    operatorAddress,
    plan,
    logicalDrawKey: key,
    progression,
    journalRevision: journal.snapshot().revision,
    journalOperationId: operation.operationId,
    journalStatus: execution.journalOperation?.status ?? operation.status,
    readiness,
    execution,
    reason: execution.reason,
  });
}

export async function runAutomaticDrawOneShotActivation(
  request: AutomaticDrawActivationRequest,
  services: AutomaticDrawActivationServices,
): Promise<AutomaticDrawActivationPublicResult> {
  if (!AUTOMATIC_DRAW_ONE_SHOT_MODES.includes(
    request.mode as AutomaticDrawOneShotMode,
  )) {
    throw new Error(
      "Usage requires exactly --mode prepare or --mode execute-once.",
    );
  }
  if (request.mode === "prepare") {
    if (!request.poolId || request.confirmation) {
      throw new Error("Prepare requires --pool and does not accept execution confirmation.");
    }
    return services.prepare(request);
  }
  if (!request.confirmation) {
    throw new Error(
      "Execute-once requires exact chain, contract, pool, and round confirmation.",
    );
  }
  return services.executeOnce(request);
}

function readRpcUrls(environment: NodeJS.ProcessEnv): {
  rpcUrl: string;
  fallbackRpcUrl?: string;
} {
  const rpcUrl = validateLifecycleSupervisorRpcUrl(
    environment.BASE_SEPOLIA_SUPERVISOR_RPC_URL?.trim() ??
      LIFECYCLE_SUPERVISOR_DEFAULT_RPC_URL,
  );
  const fallback = environment.BASE_SEPOLIA_SUPERVISOR_RPC_URL_FALLBACK?.trim();
  return {
    rpcUrl,
    ...(fallback
      ? { fallbackRpcUrl: validateLifecycleSupervisorRpcUrl(fallback) }
      : {}),
  };
}

function readTimeout(environment: NodeJS.ProcessEnv): number {
  const value = environment.POP33_INTERNAL_SUPERVISOR_TIMEOUT_MS?.trim();
  return validateLifecycleSupervisorTimeout(
    value ? Number(value) : LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  );
}

function requireExecutionDependencies(
  dependencies: AutomaticDrawExecutionReadinessDependencies,
): AutomaticDrawOneShotExecutionDependencies {
  if (
    !dependencies.loadExecutionClient ||
    !dependencies.waitForReceipt ||
    !dependencies.getTransactionCount
  ) {
    throw new Error("Base Sepolia one-shot execution dependencies are incomplete.");
  }
  return dependencies as AutomaticDrawOneShotExecutionDependencies;
}

function requestFromEnvironment(
  environment: NodeJS.ProcessEnv,
): AutomaticDrawActivationRequest {
  const mode = environment[MODE_ENV]?.trim() ?? "";
  const planPath = environment[PLAN_ENV]?.trim() ?? "";
  const poolValue = environment[POOL_ENV]?.trim();
  const hasConfirmation = Boolean(
    environment[CONFIRM_CHAIN_ENV] ||
      environment[CONFIRM_CONTRACT_ENV] ||
      environment[CONFIRM_POOL_ENV] ||
      environment[CONFIRM_ROUND_ENV],
  );
  return {
    mode,
    planPath,
    ...(poolValue
      ? { poolId: requirePositiveBigInt("Pool ID", poolValue) }
      : {}),
    ...(hasConfirmation
      ? {
          confirmation: {
            chainId: environment[CONFIRM_CHAIN_ENV]?.trim() ?? "",
            contractAddress:
              environment[CONFIRM_CONTRACT_ENV]?.trim() ?? "",
            poolId: environment[CONFIRM_POOL_ENV]?.trim() ?? "",
            roundNumber: environment[CONFIRM_ROUND_ENV]?.trim() ?? "",
          },
        }
      : {}),
  };
}

function createDefaultServices(
  environment: NodeJS.ProcessEnv,
): AutomaticDrawActivationServices {
  const operatorAddress = requireEnvironmentValue(
    environment,
    "BASE_SEPOLIA_DRAW_OPERATOR_ADDRESS",
  );
  const automaticDrawStatePath = requireEnvironmentValue(
    environment,
    "POP33_INTERNAL_AUTOMATIC_DRAW_STATE_PATH",
  );
  const transactionJournalPath = readJournalPathFromEnvironment(environment);
  const maxPlanAgeSeconds = readOptionalUnsignedBigInt(
    "Maximum plan age",
    environment.POP33_INTERNAL_SUPERVISOR_MAX_PLAN_AGE,
  );
  const rpc = readRpcUrls(environment);
  const timeoutMs = readTimeout(environment);
  return {
    async prepare(request) {
      const dependencies = createBaseSepoliaGuardedDrawDependencies({
        ...rpc,
        timeoutMs,
        poolId: request.poolId as bigint,
        operatorAddress,
      });
      return prepareAutomaticDrawActivation({
        poolId: request.poolId as bigint,
        planPath: request.planPath,
        automaticDrawStatePath,
        transactionJournalPath,
        operatorAddress,
        dependencies,
        ...(maxPlanAgeSeconds === undefined ? {} : { maxPlanAgeSeconds }),
      });
    },
    async executeOnce(request) {
      if (environment[CUTOVER_ENV]?.trim() !== "true") {
        throw new Error(
          `${CUTOVER_ENV}=true is required before execute-once.`,
        );
      }
      const planFile = await readLifecyclePlanFile(request.planPath);
      const plan = requireDrawPlan(planFile.json);
      const poolId = BigInt(plan.scope.poolId);
      const roundNumber = BigInt(plan.scope.roundNumber as string);
      const durable = {
        ...readAutomaticDrawDurableRuntimeConfig(environment, journalIdentity),
        logicalDrawKey: logicalDrawKey({
          chainId: BigInt(DEMO_V1_CHAIN_ID),
          contractAddress: DEMO_V1_CONTRACT_ADDRESS,
          poolId,
          roundNumber,
        }),
      };
      const dependencies = requireExecutionDependencies(
        createBaseSepoliaGuardedDrawDependencies({
        ...rpc,
        timeoutMs,
        poolId,
        operatorAddress,
        }),
      );
      return executeAutomaticDrawActivationOnce({
        planPath: request.planPath,
        durable,
        operatorAddress,
        confirmation: request.confirmation as AutomaticDrawActivationConfirmation,
        dependencies,
        ...(maxPlanAgeSeconds === undefined ? {} : { maxPlanAgeSeconds }),
      });
    },
  };
}

export function renderAutomaticDrawActivationResult(
  result: AutomaticDrawActivationPublicResult,
): string {
  return JSON.stringify(result, null, 2);
}

export async function runAutomaticDrawOneShotMain(
  environment: NodeJS.ProcessEnv = process.env,
  write: (value: string) => void = (value) => console.log(value),
  services?: AutomaticDrawActivationServices,
): Promise<number> {
  try {
    const request = requestFromEnvironment(environment);
    if (!request.planPath) {
      throw new Error("--plan FILE.json is required.");
    }
    const result = await runAutomaticDrawOneShotActivation(
      request,
      services ?? createDefaultServices(environment),
    );
    write(renderAutomaticDrawActivationResult(result));
    return result.exitCode;
  } catch (error) {
    write(JSON.stringify({
      status: "STOPPED",
      reason: sanitizeGuardedDrawError(error),
    }, null, 2));
    return 2;
  }
}

if (process.env[INVOKE_ENV] === "true") {
  runAutomaticDrawOneShotMain()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.exitCode = 2;
    });
}
