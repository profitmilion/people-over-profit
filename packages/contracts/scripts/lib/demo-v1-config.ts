import { getAddress, isAddress, Wallet, ZeroAddress } from "ethers";

export const BASE_SEPOLIA_CHAIN_ID = 84_532n;
export const LOCAL_HARDHAT_CHAIN_ID = 31_337n;
export const BASE_SEPOLIA_DEPLOY_CONFIRMATION = "DEPLOY_POP33_DEMO_V1";

export const DEMO_V1_PARAMETERS = Object.freeze({
  entryPrice: 33_000_000n,
  positionsPerPool: 100n,
  drawRoundCount: 10n,
  prizePerRound: 330_000_000n,
  totalPrizeAmount: 3_300_000_000n,
  drawIntervalSeconds: 3_600n,
});

export interface BaseSepoliaDeploymentConfig {
  paymentTokenAddress: string;
  drawIntervalSeconds: bigint;
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required and cannot be empty.`);
  return value;
}

function validateRpcUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BASE_SEPOLIA_RPC_URL must be a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("BASE_SEPOLIA_RPC_URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("BASE_SEPOLIA_RPC_URL must not contain URL credentials.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  ) {
    throw new Error("BASE_SEPOLIA_RPC_URL must not point to a local endpoint.");
  }
}

function validatePrivateKey(value: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      "BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY must be a 32-byte 0x-prefixed private key.",
    );
  }
  if (/^0x0{64}$/i.test(value)) {
    throw new Error("BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY cannot be the zero key.");
  }
  try {
    void new Wallet(value);
  } catch {
    throw new Error("BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY is outside the valid key range.");
  }
}

function validatePaymentToken(value: string): string {
  if (!isAddress(value)) {
    throw new Error("BASE_SEPOLIA_USDC_ADDRESS must be a valid EVM address.");
  }
  const address = getAddress(value);
  if (address === ZeroAddress) {
    throw new Error("BASE_SEPOLIA_USDC_ADDRESS cannot be the zero address.");
  }
  return address;
}

function validateDrawInterval(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error("POP33_DEMO_DRAW_INTERVAL_SECONDS must be a positive integer.");
  }
  const interval = BigInt(value);
  if (interval !== DEMO_V1_PARAMETERS.drawIntervalSeconds) {
    throw new Error(
      `POP33_DEMO_DRAW_INTERVAL_SECONDS must equal ${DEMO_V1_PARAMETERS.drawIntervalSeconds} for Demo V1.`,
    );
  }
  return interval;
}

export function readBaseSepoliaDeploymentConfig(
  env: NodeJS.ProcessEnv,
): BaseSepoliaDeploymentConfig {
  validateRpcUrl(requireValue(env, "BASE_SEPOLIA_RPC_URL"));
  validatePrivateKey(requireValue(env, "BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY"));
  const paymentTokenAddress = validatePaymentToken(
    requireValue(env, "BASE_SEPOLIA_USDC_ADDRESS"),
  );
  const drawIntervalSeconds = validateDrawInterval(
    requireValue(env, "POP33_DEMO_DRAW_INTERVAL_SECONDS"),
  );

  const confirmation = requireValue(env, "POP33_BASE_SEPOLIA_DEPLOY_CONFIRM");
  if (confirmation !== BASE_SEPOLIA_DEPLOY_CONFIRMATION) {
    throw new Error(
      `POP33_BASE_SEPOLIA_DEPLOY_CONFIRM must equal ${BASE_SEPOLIA_DEPLOY_CONFIRMATION}.`,
    );
  }

  return { paymentTokenAddress, drawIntervalSeconds };
}
