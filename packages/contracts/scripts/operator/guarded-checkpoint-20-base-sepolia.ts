import {
  createPublicClient,
  formatEther,
  formatUnits,
  getAddress,
  http,
  keccak256,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";

import { demoV1Abi, demoV1TokenAbi } from "../../../../src/demo-v1/abi.js";
import {
  DEMO_V1_CONTRACT_ADDRESS,
  DEMO_V1_TOKEN_ADDRESS,
} from "../../../../src/demo-v1/safety.js";
import {
  ViemExact99ReadinessPublicClient,
  createLiveExact99ReadinessPlan,
  type Exact99ReadinessPlan,
} from "./exact-99-base-sepolia-readiness.js";
import {
  BaseSepoliaLifecycleSnapshotAdapter,
  LIFECYCLE_SUPERVISOR_DEFAULT_RPC_URL,
  LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  ViemLifecycleSupervisorPublicClient,
  redactLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorTimeout,
} from "./lifecycle-supervisor-base-sepolia.js";
import {
  analyzeLifecycleSnapshot,
  type SupervisorReport,
  type SystemSnapshot,
} from "./lifecycle-supervisor.js";
import {
  GUARDED_CHECKPOINT_20_BASELINE,
  GUARDED_CHECKPOINT_20_CONTRACT,
  GUARDED_CHECKPOINT_20_DEFAULT_SIGNER_RESERVE_WEI,
  GUARDED_CHECKPOINT_20_ENTRY_PRICE,
  GUARDED_CHECKPOINT_20_FUNDING_PER_WALLET_WEI,
  GUARDED_CHECKPOINT_20_TARGET,
} from "./guarded-checkpoint-20.js";
import { sanitizeOperatorError } from "./transaction-journal.js";

export const GUARDED_CHECKPOINT_20_CANONICAL_POP33_RUNTIME_HASH =
  "0x9179f603974ced390dea617cb79942fff6d57ae63ec15a0eff9832237f57456c";
export const GUARDED_CHECKPOINT_20_CANONICAL_TOKEN_RUNTIME_HASH =
  "0xe85327eae5364f5bf3bab03fb34b4cdfde9ef68a506f2dbac8c36ce383645abd";
export const GUARDED_CHECKPOINT_20_READ_ONLY_FUNDING_ADDRESS =
  "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB";

export interface GuardedCheckpoint20UnsignedEstimates {
  faucet: string | null;
  approve: string | null;
  join: string | null;
  notes: readonly string[];
}

export interface GuardedCheckpoint20CandidateRead {
  address: string;
  ethBalanceWei: string;
  ethBalance: string;
  tokenBalance: string;
  allowance: string;
  nextDripAt: string;
  activePositionId: string | null;
  globalActivePositionCount: string | null;
  eligibility: string;
  routedPoolId: string | null;
}

export interface GuardedCheckpoint20FundingInspection {
  address: string;
  readOnlyOnly: true;
  balanceWei: string;
  balance: string;
  requiredDistributionWei: string;
  signerReserveWei: string;
  sufficientForDistributionAndReserve: boolean;
}

export interface GuardedCheckpoint20BaseSepoliaInspection {
  mode: "inspect";
  readOnly: true;
  executionAvailable: false;
  snapshot: SystemSnapshot;
  lifecycle: SupervisorReport;
  readiness: Exact99ReadinessPlan;
  identity: {
    chainId: string;
    contractAddress: string;
    tokenAddress: string;
    contractRuntimeHash: string;
    tokenRuntimeHash: string;
    bytecodeMatches: boolean;
  };
  pool: {
    status: string;
    activePositionCount: string;
    escrowedAmount: string;
    lockedAt: string;
    baselineRecognized: boolean;
    remainingToTarget: string;
  };
  funding: GuardedCheckpoint20FundingInspection;
  faucet: {
    dripAmount: string;
    dripAmountFormatted: string;
    cooldownSeconds: string;
  };
  candidate: GuardedCheckpoint20CandidateRead | null;
  unsignedEstimates: GuardedCheckpoint20UnsignedEstimates;
  hardStops: readonly string[];
  executionBlockers: readonly string[];
}

export interface GuardedCheckpoint20ReceiptVerification {
  readOnly: true;
  hash: string;
  status: "success" | "reverted";
  blockNumber: string;
  blockHash: string;
  from: string;
  to: string | null;
  gasUsed: string;
  effectiveGasPrice: string;
}

function client(rpcUrl: string, timeoutMs: number) {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl, { retryCount: 0, timeout: timeoutMs }),
  });
}

async function estimate(
  label: string,
  action: () => Promise<bigint>,
  notes: string[],
): Promise<string | null> {
  try {
    return (await action()).toString();
  } catch (error) {
    notes.push(`${label} unavailable: ${sanitizeOperatorError(error)}`);
    return null;
  }
}

export async function inspectGuardedCheckpoint20BaseSepolia(input: {
  rpcUrl?: string;
  timeoutMs?: number;
  candidateAddress?: string;
  fundingAddress?: string;
  signerReserveWei?: bigint;
} = {}): Promise<GuardedCheckpoint20BaseSepoliaInspection> {
  const rpcUrl = validateLifecycleSupervisorRpcUrl(
    input.rpcUrl ?? LIFECYCLE_SUPERVISOR_DEFAULT_RPC_URL,
  );
  const timeoutMs = validateLifecycleSupervisorTimeout(
    input.timeoutMs ?? LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  );
  const rpcHost = redactLifecycleSupervisorRpcUrl(rpcUrl);
  const snapshot = await new BaseSepoliaLifecycleSnapshotAdapter({
    client: new ViemLifecycleSupervisorPublicClient(rpcUrl, timeoutMs),
    rpcHost,
  }).readSnapshot();
  const lifecycle = analyzeLifecycleSnapshot(snapshot);
  const readinessClient = new ViemExact99ReadinessPublicClient(rpcUrl, timeoutMs);
  const readiness = await createLiveExact99ReadinessPlan({
    snapshot,
    report: lifecycle,
    publicClient: readinessClient,
    poolId: 1n,
    sourceReference: "base-sepolia",
    candidateAddress: input.candidateAddress,
  });
  if (snapshot.blockNumber === null) throw new Error("Checkpoint-20 inspect requires a pinned block.");
  const publicClient = client(rpcUrl, timeoutMs);
  const blockNumber = snapshot.blockNumber;
  const contractAddress = getAddress(DEMO_V1_CONTRACT_ADDRESS);
  const tokenAddress = getAddress(DEMO_V1_TOKEN_ADDRESS);
  const fundingAddress = getAddress(
    input.fundingAddress ?? GUARDED_CHECKPOINT_20_READ_ONLY_FUNDING_ADDRESS,
  );
  const [contractCode, tokenCode, linkedToken, fundingBalance, dripAmount, cooldown] = await Promise.all([
    publicClient.getBytecode({ address: contractAddress, blockNumber }),
    publicClient.getBytecode({ address: tokenAddress, blockNumber }),
    publicClient.readContract({ address: contractAddress, abi: demoV1Abi, functionName: "paymentToken", blockNumber }),
    publicClient.getBalance({ address: fundingAddress, blockNumber }),
    publicClient.readContract({ address: tokenAddress, abi: demoV1TokenAbi, functionName: "DRIP_AMOUNT", blockNumber }),
    publicClient.readContract({ address: tokenAddress, abi: demoV1TokenAbi, functionName: "DRIP_COOLDOWN", blockNumber }),
  ]);
  if (!contractCode || !tokenCode) throw new Error("Canonical deployment bytecode is missing.");
  const contractRuntimeHash = keccak256(contractCode);
  const tokenRuntimeHash = keccak256(tokenCode);
  const bytecodeMatches =
    contractRuntimeHash === GUARDED_CHECKPOINT_20_CANONICAL_POP33_RUNTIME_HASH &&
    tokenRuntimeHash === GUARDED_CHECKPOINT_20_CANONICAL_TOKEN_RUNTIME_HASH &&
    getAddress(linkedToken) === tokenAddress;
  const pool = readiness.pool;
  const activeCount = BigInt(pool.activePositionCount ?? "-1");
  const escrow = BigInt(pool.escrowedAmount ?? "-1");
  const lockedAt = BigInt(pool.lockedAt ?? "-1");
  const hardStops: string[] = [];
  if (snapshot.chainId !== 84_532n) hardStops.push("WRONG_CHAIN_ID");
  if (getAddress(snapshot.contractAddress) !== getAddress(GUARDED_CHECKPOINT_20_CONTRACT)) hardStops.push("WRONG_CONTRACT_ADDRESS");
  if (!bytecodeMatches) hardStops.push("BYTECODE_MISMATCH");
  if (pool.status !== "Open") hardStops.push("POOL_NOT_OPEN");
  if (activeCount < BigInt(GUARDED_CHECKPOINT_20_BASELINE) || activeCount > BigInt(GUARDED_CHECKPOINT_20_TARGET)) hardStops.push("COUNT_OUTSIDE_CHECKPOINT_RANGE");
  if (escrow !== activeCount * GUARDED_CHECKPOINT_20_ENTRY_PRICE) hardStops.push("ESCROW_MISMATCH");
  if (lockedAt !== 0n) hardStops.push("POOL_LOCKED");
  if (lifecycle.summary.actionableCount !== 0n) hardStops.push("LIFECYCLE_ACTIONABLE");
  if (lifecycle.summary.warningCount !== 0n) hardStops.push("LIFECYCLE_WARNING");
  if (lifecycle.summary.criticalCount !== 0n) hardStops.push("LIFECYCLE_CRITICAL");

  let candidate: GuardedCheckpoint20CandidateRead | null = null;
  const notes: string[] = [];
  let estimates: GuardedCheckpoint20UnsignedEstimates = {
    faucet: null,
    approve: null,
    join: null,
    notes: ["No candidate supplied; unsigned candidate estimates were not requested."],
  };
  if (input.candidateAddress) {
    const address = getAddress(input.candidateAddress);
    const [eth, tokenBalance, allowance, nextDripAt] = await Promise.all([
      publicClient.getBalance({ address, blockNumber }),
      publicClient.readContract({ address: tokenAddress, abi: demoV1TokenAbi, functionName: "balanceOf", args: [address], blockNumber }),
      publicClient.readContract({ address: tokenAddress, abi: demoV1TokenAbi, functionName: "allowance", args: [address, contractAddress], blockNumber }),
      publicClient.readContract({ address: tokenAddress, abi: demoV1TokenAbi, functionName: "nextDripAt", args: [address], blockNumber }),
    ]);
    candidate = {
      address,
      ethBalanceWei: eth.toString(),
      ethBalance: formatEther(eth),
      tokenBalance: formatUnits(tokenBalance, 6),
      allowance: formatUnits(allowance, 6),
      nextDripAt: nextDripAt.toString(),
      activePositionId: readiness.candidate.activePositionIdInSelectedPool,
      globalActivePositionCount: readiness.candidate.globalActivePositionCount,
      eligibility: readiness.candidate.status,
      routedPoolId: readiness.candidate.likelyPoolId,
    };
    estimates = {
      faucet: await estimate("faucet estimate", () => publicClient.estimateContractGas({
        address: tokenAddress, abi: demoV1TokenAbi, functionName: "drip", account: address,
      }), notes),
      approve: await estimate("approve estimate", () => publicClient.estimateContractGas({
        address: tokenAddress, abi: demoV1TokenAbi, functionName: "approve",
        args: [contractAddress, GUARDED_CHECKPOINT_20_ENTRY_PRICE], account: address,
      }), notes),
      join: await estimate("join estimate", () => publicClient.estimateContractGas({
        address: contractAddress, abi: demoV1Abi, functionName: "join", account: address,
      }), notes),
      notes,
    };
  }
  const signerReserve = input.signerReserveWei ?? GUARDED_CHECKPOINT_20_DEFAULT_SIGNER_RESERVE_WEI;
  return {
    mode: "inspect",
    readOnly: true,
    executionAvailable: false,
    snapshot,
    lifecycle,
    readiness,
    identity: {
      chainId: snapshot.chainId.toString(),
      contractAddress,
      tokenAddress,
      contractRuntimeHash,
      tokenRuntimeHash,
      bytecodeMatches,
    },
    pool: {
      status: pool.status,
      activePositionCount: activeCount.toString(),
      escrowedAmount: escrow.toString(),
      lockedAt: lockedAt.toString(),
      baselineRecognized: activeCount === BigInt(GUARDED_CHECKPOINT_20_BASELINE),
      remainingToTarget: (BigInt(GUARDED_CHECKPOINT_20_TARGET) - activeCount).toString(),
    },
    funding: {
      address: fundingAddress,
      readOnlyOnly: true,
      balanceWei: fundingBalance.toString(),
      balance: formatEther(fundingBalance),
      requiredDistributionWei: (GUARDED_CHECKPOINT_20_FUNDING_PER_WALLET_WEI * 15n).toString(),
      signerReserveWei: signerReserve.toString(),
      sufficientForDistributionAndReserve:
        fundingBalance >= GUARDED_CHECKPOINT_20_FUNDING_PER_WALLET_WEI * 15n + signerReserve,
    },
    faucet: {
      dripAmount: dripAmount.toString(),
      dripAmountFormatted: formatUnits(dripAmount, 6),
      cooldownSeconds: cooldown.toString(),
    },
    candidate,
    unsignedEstimates: estimates,
    hardStops,
    executionBlockers: [
      "EXECUTE is not implemented or authorized in this milestone.",
      "No real selected-record wallet store or checkpoint-20 manifest exists.",
      "No second independent RPC source is configured for transaction finality.",
      ...(candidate === null ? ["No candidate was supplied."] : []),
    ],
  };
}

export async function verifyGuardedCheckpoint20ReceiptReadOnly(input: {
  hash: Hex;
  rpcUrl?: string;
  timeoutMs?: number;
}): Promise<GuardedCheckpoint20ReceiptVerification> {
  const rpcUrl = validateLifecycleSupervisorRpcUrl(input.rpcUrl ?? LIFECYCLE_SUPERVISOR_DEFAULT_RPC_URL);
  const timeoutMs = validateLifecycleSupervisorTimeout(input.timeoutMs ?? LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS);
  const publicClient = client(rpcUrl, timeoutMs);
  const [receipt, transaction] = await Promise.all([
    publicClient.getTransactionReceipt({ hash: input.hash }),
    publicClient.getTransaction({ hash: input.hash }),
  ]);
  return {
    readOnly: true,
    hash: input.hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    from: transaction.from,
    to: transaction.to,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
  };
}

export function renderGuardedCheckpoint20BaseSepoliaInspection(
  report: GuardedCheckpoint20BaseSepoliaInspection,
): string {
  return [
    "POP33 guarded checkpoint-20 Base Sepolia inspection",
    `Pinned block: ${report.snapshot.blockNumber}`,
    `Pool 1: ${report.pool.status} ${report.pool.activePositionCount}/100`,
    `Escrow: ${report.pool.escrowedAmount} dUSDC base units`,
    `lockedAt: ${report.pool.lockedAt}`,
    `Baseline 5 recognized: ${report.pool.baselineRecognized ? "YES" : "NO"}`,
    `Remaining to 20: ${report.pool.remainingToTarget}`,
    `Lifecycle actionable/warning/critical: ${report.lifecycle.summary.actionableCount}/${report.lifecycle.summary.warningCount}/${report.lifecycle.summary.criticalCount}`,
    `Bytecode identity: ${report.identity.bytecodeMatches ? "MATCH" : "MISMATCH"}`,
    `Read-only funding balance: ${report.funding.balance} ETH`,
    `Hard stops: ${report.hardStops.length === 0 ? "none" : report.hardStops.join(", ")}`,
    ...report.executionBlockers.map((blocker) => `Execution blocker: ${blocker}`),
    "0 transactions sent. EXECUTE IS NOT AVAILABLE.",
  ].join("\n");
}
