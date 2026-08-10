import { readFile } from "node:fs/promises";

import {
  Contract,
  JsonRpcProvider,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
} from "ethers";

import { withReadOnlyRpcRetry } from "./read-only-rpc-retry.js";

export const PILOT_10_CHAIN_ID = 84_532n;
export const PILOT_10_CONTRACT_ADDRESS = getAddress(
  "0xc2fAA10d3E5FEeB88604dc3A1Ab33656fFeBCA98",
);
export const PILOT_10_TOKEN_ADDRESS = getAddress(
  "0xA7FA084b34c888061757d4b5FBb08a7B53fee786",
);
export const PILOT_10_POOL_CAPACITY = 10n;
export const PILOT_10_ENTRY_PRICE = 33_000_000n;
export const PILOT_10_DRAW_INTERVAL = 3_600n;
export const PILOT_10_MINIMUM_ETH = 50_000_000_000_000n;
export const PILOT_10_DEFAULT_RPC_URL = "https://sepolia.base.org";

const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
] as const;

const POP33_READ_ONLY_ABI = [
  "function paymentToken() view returns (address)",
  "function ENTRY_PRICE() view returns (uint256)",
  "function MAX_POSITIONS_PER_POOL() view returns (uint256)",
  "function DRAW_INTERVAL() view returns (uint64)",
  "function poolCount() view returns (uint256)",
  "function activePositionsByUser(address) view returns (uint256)",
  "function getActivePositionId(uint256,address) view returns (uint256)",
] as const;

export type WalletInventoryState = "READY" | "NEEDS_ACTION" | "ALREADY_IN_POOL";
export type WalletInventoryIssue = "NEED_ETH" | "NEED_DUSDC" | "NEED_APPROVE";

export interface PublicWalletInventoryEntry {
  label: string;
  address: string;
}

export interface ActivePilotPosition {
  poolId: bigint;
  positionId: bigint;
}

export interface Pilot10WalletSnapshot {
  nativeBalance: bigint;
  tokenBalance: bigint;
  allowance: bigint;
  activePositionCount: bigint;
  activePositions: ActivePilotPosition[];
}

export interface Pilot10InventoryRuntime {
  verifyIdentity(): Promise<{ latestBlock: number; poolCount: bigint }>;
  inspectWallet(address: string, poolCount: bigint): Promise<Pilot10WalletSnapshot>;
}

export interface Pilot10WalletReport {
  label: string;
  address: string;
  nativeBalanceWei: string;
  nativeBalanceEth: string;
  dUsdcBalanceUnits: string;
  dUsdcBalance: string;
  allowanceUnits: string;
  allowanceDUsdc: string;
  allowanceStatus: "ZERO" | "BELOW_ENTRY" | "EXACT" | "ABOVE_ENTRY";
  hasPositionInPool1: boolean;
  hasPositionInPool2: boolean;
  activePositionCount: string;
  activePositions: Array<{ poolId: string; positionId: string }>;
  meetsMinimumEth: boolean;
  meetsMinimumDUsdc: boolean;
  state: WalletInventoryState;
  issues: WalletInventoryIssue[];
}

export interface Pilot10InventoryReport {
  schemaVersion: 1;
  readOnly: true;
  safety: "READ_ONLY_NO_SIGNER_NO_BROADCAST";
  generatedAt: string;
  latestBlock: number;
  chainId: string;
  contractAddress: string;
  tokenAddress: string;
  poolCount: string;
  thresholds: {
    minimumEthWei: string;
    minimumEth: string;
    minimumDUsdcUnits: string;
    minimumDUsdc: string;
  };
  wallets: Pilot10WalletReport[];
}

function ownKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function requireExactKeys(value: object, expected: string[], label: string): void {
  const actual = ownKeys(value);
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} may contain only: ${wanted.join(", ")}.`);
  }
}

export function parsePublicWalletInventory(value: unknown): PublicWalletInventoryEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Wallet inventory must be an object containing a wallets array.");
  }
  requireExactKeys(value, ["wallets"], "Wallet inventory root");
  const wallets = (value as { wallets?: unknown }).wallets;
  if (!Array.isArray(wallets) || wallets.length === 0 || wallets.length > 100) {
    throw new Error("Wallet inventory must contain between 1 and 100 public wallets.");
  }

  const labels = new Set<string>();
  const addresses = new Set<string>();
  return wallets.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Wallet ${index + 1} must be an object.`);
    }
    requireExactKeys(entry, ["address", "label"], `Wallet ${index + 1}`);
    const label = (entry as { label?: unknown }).label;
    const addressValue = (entry as { address?: unknown }).address;
    if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 100) {
      throw new Error(`Wallet ${index + 1} label must contain 1 to 100 characters.`);
    }
    if (typeof addressValue !== "string" || !isAddress(addressValue)) {
      throw new Error(`Wallet ${index + 1} must contain a valid public EVM address.`);
    }
    const normalizedLabel = label.trim();
    const address = getAddress(addressValue);
    const labelKey = normalizedLabel.toLowerCase();
    const addressKey = address.toLowerCase();
    if (labels.has(labelKey)) throw new Error(`Duplicate wallet label: ${normalizedLabel}.`);
    if (addresses.has(addressKey)) throw new Error(`Duplicate wallet address: ${address}.`);
    labels.add(labelKey);
    addresses.add(addressKey);
    return { label: normalizedLabel, address };
  });
}

export async function loadPublicWalletInventory(path: string): Promise<PublicWalletInventoryEntry[]> {
  return parsePublicWalletInventory(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export function evaluatePilot10Wallet(snapshot: Pilot10WalletSnapshot): {
  state: WalletInventoryState;
  issues: WalletInventoryIssue[];
} {
  if (snapshot.activePositions.length > 0 || snapshot.activePositionCount > 0n) {
    return { state: "ALREADY_IN_POOL", issues: [] };
  }
  const issues: WalletInventoryIssue[] = [];
  if (snapshot.nativeBalance < PILOT_10_MINIMUM_ETH) issues.push("NEED_ETH");
  if (snapshot.tokenBalance < PILOT_10_ENTRY_PRICE) issues.push("NEED_DUSDC");
  if (issues.length === 0 && snapshot.allowance !== PILOT_10_ENTRY_PRICE) {
    issues.push("NEED_APPROVE");
  }
  return { state: issues.length === 0 ? "READY" : "NEEDS_ACTION", issues };
}

function allowanceStatus(value: bigint): Pilot10WalletReport["allowanceStatus"] {
  if (value === 0n) return "ZERO";
  if (value < PILOT_10_ENTRY_PRICE) return "BELOW_ENTRY";
  if (value === PILOT_10_ENTRY_PRICE) return "EXACT";
  return "ABOVE_ENTRY";
}

export function validatePilot10InventoryRpcUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Pilot 10 inventory RPC URL must be valid.");
  }
  if (url.protocol !== "https:") throw new Error("Pilot 10 inventory RPC URL must use HTTPS.");
  if (url.username || url.password) throw new Error("Pilot 10 inventory RPC URL must not contain credentials.");
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("Pilot 10 inventory RPC URL must not point to a local endpoint.");
  }
  return value;
}

export class EthersPilot10InventoryRuntime implements Pilot10InventoryRuntime {
  private readonly provider: JsonRpcProvider;
  private readonly token: Contract;
  private readonly pop33: Contract;

  constructor(rpcUrl: string) {
    this.provider = new JsonRpcProvider(validatePilot10InventoryRpcUrl(rpcUrl));
    this.token = new Contract(PILOT_10_TOKEN_ADDRESS, TOKEN_ABI, this.provider);
    this.pop33 = new Contract(PILOT_10_CONTRACT_ADDRESS, POP33_READ_ONLY_ABI, this.provider);
  }

  private read<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return withReadOnlyRpcRetry(label, operation);
  }

  async verifyIdentity(): Promise<{ latestBlock: number; poolCount: bigint }> {
    const [network, latestBlock, contractCode, tokenCode, paymentToken, entryPrice, capacity, interval, symbol, decimals, poolCount] = await Promise.all([
      this.read("eth_chainId", () => this.provider.getNetwork()),
      this.read("eth_blockNumber", () => this.provider.getBlockNumber()),
      this.read("Pilot 10 eth_getCode", () => this.provider.getCode(PILOT_10_CONTRACT_ADDRESS)),
      this.read("dUSDC eth_getCode", () => this.provider.getCode(PILOT_10_TOKEN_ADDRESS)),
      this.read("Pilot 10 paymentToken", () => this.pop33.paymentToken()),
      this.read("Pilot 10 ENTRY_PRICE", () => this.pop33.ENTRY_PRICE()),
      this.read("Pilot 10 MAX_POSITIONS_PER_POOL", () => this.pop33.MAX_POSITIONS_PER_POOL()),
      this.read("Pilot 10 DRAW_INTERVAL", () => this.pop33.DRAW_INTERVAL()),
      this.read("dUSDC symbol", () => this.token.symbol()),
      this.read("dUSDC decimals", () => this.token.decimals()),
      this.read("Pilot 10 poolCount", () => this.pop33.poolCount()),
    ]);
    if (network.chainId !== PILOT_10_CHAIN_ID) throw new Error(`Unexpected chain ID ${network.chainId}.`);
    if (contractCode === "0x" || tokenCode === "0x") throw new Error("Pilot 10 or dUSDC bytecode is missing.");
    if (getAddress(paymentToken) !== PILOT_10_TOKEN_ADDRESS) throw new Error("Pilot 10 payment token mismatch.");
    if (entryPrice !== PILOT_10_ENTRY_PRICE) throw new Error("Pilot 10 entry price mismatch.");
    if (capacity !== PILOT_10_POOL_CAPACITY) throw new Error("Pilot 10 pool capacity mismatch.");
    if (interval !== PILOT_10_DRAW_INTERVAL) throw new Error("Pilot 10 draw interval mismatch.");
    if (symbol !== "dUSDC" || decimals !== 6n) throw new Error("Pilot 10 dUSDC identity mismatch.");
    return { latestBlock, poolCount };
  }

  async inspectWallet(addressValue: string, poolCount: bigint): Promise<Pilot10WalletSnapshot> {
    const address = getAddress(addressValue);
    const [nativeBalance, tokenBalance, allowance, activePositionCount] = await Promise.all([
      this.read(`${address} eth_getBalance`, () => this.provider.getBalance(address)),
      this.read(`${address} dUSDC balance`, () => this.token.balanceOf(address)),
      this.read(`${address} Pilot 10 allowance`, () => this.token.allowance(address, PILOT_10_CONTRACT_ADDRESS)),
      this.read(`${address} active position count`, () => this.pop33.activePositionsByUser(address)),
    ]);
    const activePositions: ActivePilotPosition[] = [];
    for (let poolId = 1n; poolId <= poolCount; poolId += 1n) {
      const positionId = await this.read(
        `${address} pool ${poolId} active position`,
        () => this.pop33.getActivePositionId(poolId, address),
      );
      if (positionId > 0n) activePositions.push({ poolId, positionId });
    }
    if (BigInt(activePositions.length) !== activePositionCount) {
      throw new Error(`Active-position count mismatch for ${address}.`);
    }
    return { nativeBalance, tokenBalance, allowance, activePositionCount, activePositions };
  }
}

export async function runPilot10WalletInventory(
  runtime: Pilot10InventoryRuntime,
  wallets: PublicWalletInventoryEntry[],
): Promise<Pilot10InventoryReport> {
  const identity = await runtime.verifyIdentity();
  const reports: Pilot10WalletReport[] = [];
  for (const wallet of wallets) {
    const snapshot = await runtime.inspectWallet(wallet.address, identity.poolCount);
    const evaluation = evaluatePilot10Wallet(snapshot);
    reports.push({
      label: wallet.label,
      address: getAddress(wallet.address),
      nativeBalanceWei: snapshot.nativeBalance.toString(),
      nativeBalanceEth: formatEther(snapshot.nativeBalance),
      dUsdcBalanceUnits: snapshot.tokenBalance.toString(),
      dUsdcBalance: formatUnits(snapshot.tokenBalance, 6),
      allowanceUnits: snapshot.allowance.toString(),
      allowanceDUsdc: formatUnits(snapshot.allowance, 6),
      allowanceStatus: allowanceStatus(snapshot.allowance),
      hasPositionInPool1: snapshot.activePositions.some(({ poolId }) => poolId === 1n),
      hasPositionInPool2: snapshot.activePositions.some(({ poolId }) => poolId === 2n),
      activePositionCount: snapshot.activePositionCount.toString(),
      activePositions: snapshot.activePositions.map(({ poolId, positionId }) => ({
        poolId: poolId.toString(),
        positionId: positionId.toString(),
      })),
      meetsMinimumEth: snapshot.nativeBalance >= PILOT_10_MINIMUM_ETH,
      meetsMinimumDUsdc: snapshot.tokenBalance >= PILOT_10_ENTRY_PRICE,
      state: evaluation.state,
      issues: evaluation.issues,
    });
  }
  return {
    schemaVersion: 1,
    readOnly: true,
    safety: "READ_ONLY_NO_SIGNER_NO_BROADCAST",
    generatedAt: new Date().toISOString(),
    latestBlock: identity.latestBlock,
    chainId: PILOT_10_CHAIN_ID.toString(),
    contractAddress: PILOT_10_CONTRACT_ADDRESS,
    tokenAddress: PILOT_10_TOKEN_ADDRESS,
    poolCount: identity.poolCount.toString(),
    thresholds: {
      minimumEthWei: PILOT_10_MINIMUM_ETH.toString(),
      minimumEth: formatEther(PILOT_10_MINIMUM_ETH),
      minimumDUsdcUnits: PILOT_10_ENTRY_PRICE.toString(),
      minimumDUsdc: formatUnits(PILOT_10_ENTRY_PRICE, 6),
    },
    wallets: reports,
  };
}

export function renderPilot10WalletInventory(report: Pilot10InventoryReport): string {
  const lines = [
    "POP33 Pilot 10 wallet inventory",
    `Safety: ${report.safety}`,
    `Block: ${report.latestBlock}; pools: ${report.poolCount}`,
    `Contract: ${report.contractAddress}`,
    "",
  ];
  for (const wallet of report.wallets) {
    const positions = wallet.activePositions.length === 0
      ? "none"
      : wallet.activePositions.map(({ poolId, positionId }) => `pool ${poolId} / position ${positionId}`).join(", ");
    lines.push(
      `${wallet.label} — ${wallet.address}`,
      `  ETH: ${wallet.nativeBalanceEth}; dUSDC: ${wallet.dUsdcBalance}; allowance: ${wallet.allowanceDUsdc} (${wallet.allowanceStatus})`,
      `  Pool 1: ${wallet.hasPositionInPool1 ? "YES" : "NO"}; Pool 2: ${wallet.hasPositionInPool2 ? "YES" : "NO"}; active: ${positions}`,
      `  State: ${wallet.state}; issues: ${wallet.issues.length === 0 ? "none" : wallet.issues.join(", ")}`,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}
