import { formatEther, getAddress, ZeroAddress } from "ethers";

import { DEMO_V1_PARAMETERS } from "../lib/demo-v1-config.js";

export const PUBLIC_OPERATOR_CHAIN_ID = 84_532n;
export const PUBLIC_OPERATOR_TOKEN_ADDRESS = getAddress(
  "0xA7FA084b34c888061757d4b5FBb08a7B53fee786",
);
export const PUBLIC_OPERATOR_CONTRACT_ADDRESS = getAddress(
  "0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F",
);
export const PUBLIC_OPERATOR_DEFAULT_RPC_URL = "https://sepolia.base.org";
export const PUBLIC_OPERATOR_PURPOSE = "pop33-demo-v1-base-sepolia";

export const PUBLIC_OPERATOR_MODES = ["preflight", "status", "plan", "dry-run"] as const;
export type PublicOperatorMode = (typeof PUBLIC_OPERATOR_MODES)[number];
export type PlannedAction = "fund" | "faucet" | "approve" | "join" | "withdraw" | "draw" | "claim";

export interface PublicContractIdentity {
  paymentToken: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: bigint;
  dripAmount: bigint;
  dripCooldown: bigint;
  entryAmount: bigint;
  maxParticipants: bigint;
  maxActivePositions: bigint;
  roundCount: bigint;
  drawInterval: bigint;
  poolCount: bigint;
}

export interface PublicPoolSnapshot {
  id: bigint;
  status: bigint;
  activePositionCount: bigint;
  escrowedAmount: bigint;
  lockedAt: bigint;
  completedDrawRoundCount: bigint;
  claimedPrizeCount: bigint;
}

export interface PublicRoundSnapshot {
  number: bigint;
  scheduledAt: bigint;
  executedAt: bigint;
  status: bigint;
  winningPositionId: bigint;
  winner: string;
  claimed: boolean;
}

export interface PublicWalletSnapshot {
  address: string;
  nativeBalance: bigint;
  tokenBalance: bigint;
  allowance: bigint;
  nextDripAt: bigint;
  activePositions: bigint;
  activePositionId: bigint;
  claimablePrizes: bigint;
  nonceLatest: number;
  noncePending: number;
}

export interface PublicReadOnlyRuntime {
  getChainId(): Promise<bigint>;
  getLatestBlockNumber(): Promise<number>;
  getLatestBlockTimestamp(): Promise<bigint>;
  getCode(address: string): Promise<string>;
  getFeePerGas(): Promise<bigint>;
  getContractIdentity(): Promise<PublicContractIdentity>;
  getOpenPoolIds(): Promise<bigint[]>;
  getPool(poolId: bigint): Promise<PublicPoolSnapshot>;
  getRounds(poolId: bigint, count: bigint): Promise<PublicRoundSnapshot[]>;
  getWallet(address: string, poolId: bigint): Promise<PublicWalletSnapshot>;
  estimateAction(input: {
    action: Exclude<PlannedAction, "fund">;
    from: string;
    poolId: bigint;
    positionId?: bigint;
    round?: bigint;
  }): Promise<bigint>;
}

export interface ArtifactCheck {
  name: "wallet-store" | "manifest" | "checkpoint" | "journal" | "project-identity" | "recovery";
  ok: boolean;
  detail: string;
}

export interface ArtifactAudit {
  walletAddresses: string[];
  checks: ArtifactCheck[];
  pendingRecoveryOperations: number;
  minimumConfirmations: number;
  leastConfirmedDepth: number | null;
  journalStatesByWallet: Record<string, string[]>;
}

export interface GasEstimateReport {
  action: PlannedAction;
  wallet: string | null;
  status: "ESTIMATED" | "NOT CURRENTLY ESTIMABLE" | "SAFETY BUDGET";
  gasUnits: string | null;
  estimatedCostWei: string | null;
  estimatedCostEth: string | null;
  safetyMultiplier: string;
  reason: string;
}

export interface WalletDryRunReport {
  index: number;
  address: string;
  nativeBalanceWei: string;
  tokenBalanceUnits: string;
  allowanceUnits: string;
  nextDripAt: string;
  activePositions: string;
  poolId: string;
  activePositionId: string;
  claimablePrizeUnits: string;
  nonceLatest: number;
  noncePending: number;
  journalStates: string[];
  stage: string;
  plannedActions: PlannedAction[];
  blockers: string[];
  nativeFundingRequiredWei: string;
}

export interface PublicOperatorReport {
  schemaVersion: 1;
  readOnly: true;
  generatedAt: string;
  mode: PublicOperatorMode;
  safety: "READ_ONLY_NO_SIGNING_NO_BROADCAST";
  purpose: typeof PUBLIC_OPERATOR_PURPOSE;
  chain: {
    chainId: string;
    latestBlock: number;
    latestTimestamp: string;
    feePerGasWei: string;
    rpcHost: string;
    tokenAddress: string;
    contractAddress: string;
    tokenCodePresent: boolean;
    contractCodePresent: boolean;
  };
  identity: Record<string, string>;
  pool: {
    id: string;
    status: string;
    activePositionCount: string;
    escrowedAmount: string;
    completedDrawRoundCount: string;
    claimedPrizeCount: string;
  };
  artifacts: ArtifactAudit;
  walletRange: { startIndex: number; requested: number; loaded: number };
  wallets: WalletDryRunReport[];
  gasPlan: GasEstimateReport[];
  totals: {
    nativeFundingRequiredWei: string;
    nativeFundingRequiredEth: string;
    currentNativeBalanceWei: string;
    currentTokenBalanceUnits: string;
    recommendedLifecycleReserveWei: string;
    recommendedLifecycleReserveEth: string;
    faucetOperations: number;
    approvalOperations: number;
    joinOperations: number;
    immediatelyWithdrawablePositions: number;
    eventualDrawOperations: number;
    eventualClaimOperations: number;
    predictedTransactionCount: number;
    finalJoinBoundaryOperations: number;
  };
  blockers: string[];
  warnings: string[];
  readyForSeparatelyAuthorizedPilot: boolean;
  recommendedNextAction: string;
}

const GAS_SAFETY = Object.freeze({
  faucet: 150_000n,
  approve: 100_000n,
  join: 400_000n,
  withdraw: 250_000n,
  draw: 650_000n,
  claim: 250_000n,
});
const GAS_PRICE_BUFFER = 2n;

function requireCode(code: string, label: string): void {
  if (!/^0x[0-9a-fA-F]+$/.test(code) || code === "0x") {
    throw new Error(`${label} address has no deployed bytecode.`);
  }
}

function requireEqual(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}.`);
  }
}

export function assertPublicOperatorMode(value: string): PublicOperatorMode {
  if (!PUBLIC_OPERATOR_MODES.includes(value as PublicOperatorMode)) {
    throw new Error("Mode must be one of: preflight, status, plan, dry-run.");
  }
  return value as PublicOperatorMode;
}

export function assertPublicOperatorWalletCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error("Wallet count must be an integer between 1 and 100.");
  }
  return value;
}

export function validatePublicOperatorRpcUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Base Sepolia operator RPC URL must be a valid URL.");
  }
  if (url.protocol !== "https:") throw new Error("Base Sepolia operator RPC URL must use HTTPS.");
  if (url.username || url.password) throw new Error("Base Sepolia operator RPC URL must not contain credentials.");
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("Base Sepolia operator RPC URL must not point to a local endpoint.");
  }
  return value;
}

function poolStatus(value: bigint): string {
  return ["Open", "Locked", "Drawing", "Claimable", "Finished"][Number(value)] ?? `Unknown(${value})`;
}

async function estimate(
  runtime: PublicReadOnlyRuntime,
  input: Parameters<PublicReadOnlyRuntime["estimateAction"]>[0],
  reason: string,
  feePerGas: bigint,
): Promise<GasEstimateReport> {
  try {
    const gasUnits = await runtime.estimateAction(input);
    return {
      action: input.action,
      wallet: input.from,
      status: "ESTIMATED",
      gasUnits: gasUnits.toString(),
      estimatedCostWei: (gasUnits * feePerGas).toString(),
      estimatedCostEth: formatEther(gasUnits * feePerGas),
      safetyMultiplier: "2x",
      reason: "Live eth_estimateGas completed without signing or broadcasting.",
    };
  } catch {
    return {
      action: input.action,
      wallet: input.from,
      status: "NOT CURRENTLY ESTIMABLE",
      gasUnits: null,
      estimatedCostWei: null,
      estimatedCostEth: null,
      safetyMultiplier: "2x",
      reason,
    };
  }
}

async function mapBatched<T, R>(items: readonly T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  for (let offset = 0; offset < items.length; offset += 5) {
    output.push(...await Promise.all(items.slice(offset, offset + 5).map(worker)));
  }
  return output;
}

export async function runBaseSepoliaReadOnlyOperator(input: {
  runtime: PublicReadOnlyRuntime;
  mode: PublicOperatorMode;
  walletCount: number;
  startIndex?: number;
  rpcHost?: string;
  artifacts: ArtifactAudit;
  now?: Date;
}): Promise<PublicOperatorReport> {
  const walletCount = assertPublicOperatorWalletCount(input.walletCount);
  const startIndex = input.startIndex ?? 0;
  if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex > 99) {
    throw new Error("Wallet start index must be an integer between 0 and 99.");
  }
  if (startIndex + walletCount > 100) {
    throw new Error("Wallet range cannot extend beyond operator index 99.");
  }
  const addresses = input.artifacts.walletAddresses.slice(startIndex, startIndex + walletCount).map(getAddress);
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) {
    throw new Error("Selected operator wallet range contains duplicate addresses.");
  }

  const [chainId, latestBlock, latestTimestamp, tokenCode, contractCode, feePerGas, identity, openPoolIds] =
    await Promise.all([
      input.runtime.getChainId(),
      input.runtime.getLatestBlockNumber(),
      input.runtime.getLatestBlockTimestamp(),
      input.runtime.getCode(PUBLIC_OPERATOR_TOKEN_ADDRESS),
      input.runtime.getCode(PUBLIC_OPERATOR_CONTRACT_ADDRESS),
      input.runtime.getFeePerGas(),
      input.runtime.getContractIdentity(),
      input.runtime.getOpenPoolIds(),
    ]);
  requireEqual(chainId, PUBLIC_OPERATOR_CHAIN_ID, "Base Sepolia chain ID");
  requireCode(tokenCode, "dUSDC");
  requireCode(contractCode, "POP33");
  if (getAddress(identity.paymentToken) !== PUBLIC_OPERATOR_TOKEN_ADDRESS) {
    throw new Error("POP33 paymentToken linkage does not match the recorded dUSDC address.");
  }
  if (identity.tokenName !== "POP33 Demo USD" || identity.tokenSymbol !== "dUSDC") {
    throw new Error("Token name or symbol does not match the recorded Demo V1 token.");
  }
  requireEqual(identity.tokenDecimals, 6n, "dUSDC decimals");
  requireEqual(identity.dripAmount, DEMO_V1_PARAMETERS.dripAmount, "dUSDC DRIP_AMOUNT");
  requireEqual(identity.dripCooldown, DEMO_V1_PARAMETERS.dripCooldownSeconds, "dUSDC DRIP_COOLDOWN");
  requireEqual(identity.entryAmount, DEMO_V1_PARAMETERS.entryPrice, "POP33 ENTRY_PRICE");
  requireEqual(identity.maxParticipants, DEMO_V1_PARAMETERS.positionsPerPool, "POP33 MAX_POSITIONS_PER_POOL");
  requireEqual(identity.maxActivePositions, 10n, "POP33 MAX_ACTIVE_POSITIONS_PER_USER");
  requireEqual(identity.roundCount, DEMO_V1_PARAMETERS.drawRoundCount, "POP33 DRAW_ROUNDS");
  requireEqual(identity.drawInterval, DEMO_V1_PARAMETERS.drawIntervalSeconds, "POP33 DRAW_INTERVAL");
  if (identity.poolCount <= 0n) throw new Error("POP33 has no pool to inspect.");
  if (feePerGas <= 0n) throw new Error("Provider returned no usable positive fee per gas.");

  const selectedPoolId = openPoolIds[0] ?? identity.poolCount;
  const [pool, rounds] = await Promise.all([
    input.runtime.getPool(selectedPoolId),
    input.runtime.getRounds(selectedPoolId, identity.roundCount),
  ]);
  const snapshots = await mapBatched(addresses, (address) => input.runtime.getWallet(address, selectedPoolId));
  const gasPlan: GasEstimateReport[] = [];
  const wallets: WalletDryRunReport[] = [];
  const perWalletSafetyGas = GAS_SAFETY.faucet + GAS_SAFETY.approve + GAS_SAFETY.join + GAS_SAFETY.withdraw;
  const targetNativeBalance = perWalletSafetyGas * feePerGas * GAS_PRICE_BUFFER;
  let nativeFundingRequired = 0n;
  let currentNativeBalance = 0n;
  let currentTokenBalance = 0n;
  let faucetOperations = 0;
  let approvalOperations = 0;
  let joinOperations = 0;
  let withdrawOperations = 0;

  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    currentNativeBalance += snapshot.nativeBalance;
    currentTokenBalance += snapshot.tokenBalance;
    const actions: PlannedAction[] = [];
    const blockers: string[] = [];
    const funding = snapshot.nativeBalance < targetNativeBalance
      ? targetNativeBalance - snapshot.nativeBalance
      : 0n;
    if (funding > 0n) actions.push("fund");
    nativeFundingRequired += funding;

    if (snapshot.tokenBalance < identity.entryAmount) {
      actions.push("faucet");
      faucetOperations += 1;
      if (snapshot.nextDripAt > latestTimestamp) blockers.push("Faucet cooldown has not elapsed.");
    }
    if (snapshot.allowance !== identity.entryAmount) {
      actions.push("approve");
      approvalOperations += 1;
    }
    if (snapshot.activePositionId > 0n) {
      if (pool.status === 0n) {
        actions.push("withdraw");
        withdrawOperations += 1;
      }
    } else if (snapshot.activePositions < identity.maxActivePositions && pool.status === 0n) {
      actions.push("join");
      joinOperations += 1;
    } else if (snapshot.activePositions >= identity.maxActivePositions) {
      blockers.push("Maximum active-position limit reached.");
    } else {
      blockers.push("Selected pool is not Open for a join.");
    }

    const stage = snapshot.activePositionId > 0n
      ? "joined"
      : snapshot.tokenBalance < identity.entryAmount
        ? "needs-faucet"
        : snapshot.allowance !== identity.entryAmount
          ? "needs-exact-approval"
          : "ready-to-join";
    wallets.push({
      index: startIndex + index,
      address: snapshot.address,
      nativeBalanceWei: snapshot.nativeBalance.toString(),
      tokenBalanceUnits: snapshot.tokenBalance.toString(),
      allowanceUnits: snapshot.allowance.toString(),
      nextDripAt: snapshot.nextDripAt.toString(),
      activePositions: snapshot.activePositions.toString(),
      poolId: snapshot.activePositionId > 0n ? selectedPoolId.toString() : "0",
      activePositionId: snapshot.activePositionId.toString(),
      claimablePrizeUnits: snapshot.claimablePrizes.toString(),
      nonceLatest: snapshot.nonceLatest,
      noncePending: snapshot.noncePending,
      journalStates: input.artifacts.journalStatesByWallet[snapshot.address.toLowerCase()] ?? [],
      stage,
      plannedActions: actions,
      blockers,
      nativeFundingRequiredWei: funding.toString(),
    });

    if (input.mode !== "status") {
      gasPlan.push({
        action: "fund",
        wallet: snapshot.address,
        status: "SAFETY BUDGET",
        gasUnits: "21000",
        estimatedCostWei: (21_000n * feePerGas).toString(),
        estimatedCostEth: formatEther(21_000n * feePerGas),
        safetyMultiplier: "2x",
        reason: "Native transfer safety budget only; no funding source is loaded by this operator.",
      });
      if (actions.includes("faucet") && snapshot.nextDripAt <= latestTimestamp) {
        gasPlan.push(await estimate(input.runtime, {
          action: "faucet", from: snapshot.address, poolId: selectedPoolId,
        }, "Faucet is not currently callable for this wallet state.", feePerGas));
      }
      if (actions.includes("approve")) {
        gasPlan.push(await estimate(input.runtime, {
          action: "approve", from: snapshot.address, poolId: selectedPoolId,
        }, "Approval is not currently estimable for this wallet.", feePerGas));
      }
      if (actions.includes("join")) {
        if (snapshot.tokenBalance >= identity.entryAmount && snapshot.allowance >= identity.entryAmount) {
          gasPlan.push(await estimate(input.runtime, {
            action: "join", from: snapshot.address, poolId: selectedPoolId,
          }, "Join reverted during read-only estimation.", feePerGas));
        } else {
          gasPlan.push({
            action: "join", wallet: snapshot.address, status: "NOT CURRENTLY ESTIMABLE", gasUnits: null,
            estimatedCostWei: null, safetyMultiplier: "2x",
            estimatedCostEth: null,
            reason: "Join depends on the preceding faucet and exact approval state transitions.",
          });
        }
      }
      if (actions.includes("withdraw")) {
        gasPlan.push(await estimate(input.runtime, {
          action: "withdraw", from: snapshot.address, poolId: selectedPoolId,
          positionId: snapshot.activePositionId,
        }, "Withdrawal is not currently estimable for the live position state.", feePerGas));
      }
    }
  }

  if (input.mode !== "status" && addresses.length > 0) {
    const nextRound = rounds.find((round) => round.status === 0n);
    if (nextRound && pool.status !== 0n && nextRound.scheduledAt <= latestTimestamp) {
      gasPlan.push(await estimate(input.runtime, {
        action: "draw", from: addresses[0], poolId: selectedPoolId, round: nextRound.number,
      }, "Next draw is not currently executable.", feePerGas));
    } else {
      gasPlan.push({
        action: "draw", wallet: addresses[0], status: "NOT CURRENTLY ESTIMABLE", gasUnits: null,
        estimatedCostWei: null, safetyMultiplier: "2x",
        estimatedCostEth: null,
        reason: "Draw is unavailable until the pool locks and the next scheduled round is due.",
      });
    }
    const selected = new Set(addresses.map((address) => address.toLowerCase()));
    const claim = rounds.find((round) => round.status === 1n && !round.claimed && selected.has(round.winner.toLowerCase()));
    if (claim && claim.winner !== ZeroAddress) {
      gasPlan.push(await estimate(input.runtime, {
        action: "claim", from: claim.winner, poolId: selectedPoolId, round: claim.number,
      }, "Claim is not currently executable by its recorded winner.", feePerGas));
    } else {
      gasPlan.push({
        action: "claim", wallet: null, status: "NOT CURRENTLY ESTIMABLE", gasUnits: null,
        estimatedCostWei: null, safetyMultiplier: "2x",
        estimatedCostEth: null,
        reason: "No unclaimed finalized round belongs to the selected wallet range.",
      });
    }
  }

  const blockers = input.artifacts.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
  if (input.artifacts.walletAddresses.length < startIndex + walletCount) {
    blockers.push(`Wallet store exposes ${input.artifacts.walletAddresses.length} wallets but range ${startIndex}..${startIndex + walletCount - 1} was requested.`);
  }
  if (input.artifacts.pendingRecoveryOperations > 0) {
    blockers.push(`${input.artifacts.pendingRecoveryOperations} journal operation(s) require recovery review.`);
  }
  if (input.artifacts.leastConfirmedDepth !== null &&
      input.artifacts.leastConfirmedDepth < input.artifacts.minimumConfirmations) {
    blockers.push("At least one confirmed journal transaction lacks the required confirmation depth.");
  }
  for (const wallet of wallets) blockers.push(...wallet.blockers.map((blocker) => `${wallet.address}: ${blocker}`));
  if (pool.status !== 0n && pool.status !== 1n && pool.status !== 2n && pool.status !== 3n && pool.status !== 4n) {
    blockers.push("Pool status is outside the supported lifecycle enum.");
  }

  const warnings = [
    "No transaction was signed, sent, funded, deployed, or retried.",
    "Gas estimates are state-dependent and are not authorization to execute.",
    "The 100th join remains a separate irreversible lock boundary and public execution is not implemented.",
    "Temporary draw entropy is manipulable and not production-safe.",
  ];
  const remainingDraws = identity.roundCount - pool.completedDrawRoundCount;
  const remainingClaims = identity.roundCount - pool.claimedPrizeCount;
  const recommendedLifecycleReserve = (
    perWalletSafetyGas * BigInt(walletCount) +
    GAS_SAFETY.draw * remainingDraws +
    GAS_SAFETY.claim * remainingClaims
  ) * feePerGas * GAS_PRICE_BUFFER;
  const predictedTransactionCount = faucetOperations + approvalOperations + joinOperations +
    withdrawOperations + Number(remainingDraws) + Number(remainingClaims) +
    wallets.filter((wallet) => BigInt(wallet.nativeFundingRequiredWei) > 0n).length;
  const ready = blockers.length === 0 && addresses.length === walletCount;
  return {
    schemaVersion: 1,
    readOnly: true,
    generatedAt: (input.now ?? new Date()).toISOString(),
    mode: input.mode,
    safety: "READ_ONLY_NO_SIGNING_NO_BROADCAST",
    purpose: PUBLIC_OPERATOR_PURPOSE,
    chain: {
      chainId: chainId.toString(), latestBlock, latestTimestamp: latestTimestamp.toString(),
      feePerGasWei: feePerGas.toString(), tokenAddress: PUBLIC_OPERATOR_TOKEN_ADDRESS,
      rpcHost: input.rpcHost ?? "not-reported",
      contractAddress: PUBLIC_OPERATOR_CONTRACT_ADDRESS, tokenCodePresent: true, contractCodePresent: true,
    },
    identity: {
      paymentToken: getAddress(identity.paymentToken), tokenName: identity.tokenName,
      tokenSymbol: identity.tokenSymbol, tokenDecimals: identity.tokenDecimals.toString(),
      DRIP_AMOUNT: identity.dripAmount.toString(), DRIP_COOLDOWN: identity.dripCooldown.toString(),
      ENTRY_AMOUNT: identity.entryAmount.toString(), MAX_PARTICIPANTS: identity.maxParticipants.toString(),
      MAX_ACTIVE_POSITIONS: identity.maxActivePositions.toString(), ROUND_COUNT: identity.roundCount.toString(),
      DRAW_INTERVAL: identity.drawInterval.toString(),
    },
    pool: {
      id: pool.id.toString(), status: poolStatus(pool.status),
      activePositionCount: pool.activePositionCount.toString(), escrowedAmount: pool.escrowedAmount.toString(),
      completedDrawRoundCount: pool.completedDrawRoundCount.toString(), claimedPrizeCount: pool.claimedPrizeCount.toString(),
    },
    artifacts: input.artifacts,
    walletRange: { startIndex, requested: walletCount, loaded: addresses.length },
    wallets,
    gasPlan,
    totals: {
      nativeFundingRequiredWei: nativeFundingRequired.toString(), faucetOperations, approvalOperations,
      nativeFundingRequiredEth: formatEther(nativeFundingRequired),
      currentNativeBalanceWei: currentNativeBalance.toString(),
      currentTokenBalanceUnits: currentTokenBalance.toString(),
      recommendedLifecycleReserveWei: recommendedLifecycleReserve.toString(),
      recommendedLifecycleReserveEth: formatEther(recommendedLifecycleReserve),
      joinOperations, immediatelyWithdrawablePositions: withdrawOperations,
      eventualDrawOperations: Number(remainingDraws),
      eventualClaimOperations: Number(remainingClaims),
      predictedTransactionCount,
      finalJoinBoundaryOperations: walletCount === 100 && joinOperations > 0 ? 1 : 0,
    },
    blockers,
    warnings,
    readyForSeparatelyAuthorizedPilot: ready,
    recommendedNextAction: ready
      ? "Independently review this report; any 2–5 wallet write pilot requires a new task and explicit authorization."
      : "Resolve every blocker and rerun preflight and dry-run without enabling a write transport.",
  };
}

export function renderPublicOperatorText(report: PublicOperatorReport): string {
  const lines = [
    "POP33 Base Sepolia public operator — READ ONLY / DRY RUN",
    `READ_ONLY: ${report.readOnly}`,
    `Mode: ${report.mode}`,
    `Chain: ${report.chain.chainId}; RPC host: ${report.chain.rpcHost}; latest block: ${report.chain.latestBlock}`,
    `Current gas price: ${report.chain.feePerGasWei} wei`,
    `dUSDC: ${report.chain.tokenAddress}`,
    `POP33: ${report.chain.contractAddress}`,
    `Pool ${report.pool.id}: ${report.pool.status}, ${report.pool.activePositionCount}/100 positions`,
    `Wallet range: start=${report.walletRange.startIndex}, loaded=${report.walletRange.loaded}/${report.walletRange.requested}`,
    `Artifacts: ${report.artifacts.checks.map((check) => `${check.name}=${check.ok ? "OK" : "BLOCKED"}`).join(", ")}`,
    `Planned totals: faucet=${report.totals.faucetOperations}, approve=${report.totals.approvalOperations}, join=${report.totals.joinOperations}, withdraw-now=${report.totals.immediatelyWithdrawablePositions}, eventual-draw=${report.totals.eventualDrawOperations}, eventual-claim=${report.totals.eventualClaimOperations}`,
    `Native funding requirement: ${report.totals.nativeFundingRequiredWei} wei`,
    `Native funding requirement: ${report.totals.nativeFundingRequiredEth} ETH`,
    `Recommended full-lifecycle reserve (2x): ${report.totals.recommendedLifecycleReserveWei} wei (${report.totals.recommendedLifecycleReserveEth} ETH)`,
    `Predicted transaction count: ${report.totals.predictedTransactionCount}`,
  ];
  for (const wallet of report.wallets) {
    const compact = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
    lines.push(`Wallet ${wallet.index}: ${compact} — ${wallet.stage}; nonces=${wallet.nonceLatest}/${wallet.noncePending}; plan=${wallet.plannedActions.join("->") || "none"}`);
  }
  for (const blocker of report.blockers) lines.push(`BLOCKER: ${blocker}`);
  for (const gas of report.gasPlan) {
    lines.push(`GAS ${gas.action}: ${gas.status}; units=${gas.gasUnits ?? "n/a"}; cost=${gas.estimatedCostWei ?? "n/a"} wei (${gas.estimatedCostEth ?? "n/a"} ETH); ${gas.reason}`);
  }
  for (const warning of report.warnings) lines.push(`WARNING: ${warning}`);
  lines.push(`Result: ${report.readyForSeparatelyAuthorizedPilot ? "READY" : "NOT READY"} for a separately authorized 2–5 wallet pilot.`);
  lines.push(`Recommended next action: ${report.recommendedNextAction}`);
  return lines.join("\n");
}
