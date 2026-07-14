import { getAddress, isAddress, type Address } from "viem";

export const DEMO_V1_CHAIN_ID = 84_532;
export const DEMO_V1_DEPLOYER = getAddress(
  "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB",
);

type DemoV1ConfigError =
  | "missing-contract"
  | "invalid-contract"
  | "missing-token"
  | "invalid-token"
  | "missing-chain-id"
  | "invalid-chain-id"
  | "missing-rpc"
  | "invalid-rpc";

const rawContractAddress = import.meta.env
  .VITE_POP33_DEMO_V1_CONTRACT_ADDRESS as string | undefined;
const rawTokenAddress = import.meta.env.VITE_POP33_DEMO_V1_TOKEN_ADDRESS as
  | string
  | undefined;
const rawChainId = import.meta.env.VITE_POP33_DEMO_V1_CHAIN_ID as
  | string
  | undefined;
const rawRpcUrl = import.meta.env.VITE_POP33_DEMO_V1_RPC_URL as
  | string
  | undefined;

function parseAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? getAddress(value) : undefined;
}

function validate(): DemoV1ConfigError[] {
  const errors: DemoV1ConfigError[] = [];
  if (!rawContractAddress) errors.push("missing-contract");
  else if (!parseAddress(rawContractAddress)) errors.push("invalid-contract");
  if (!rawTokenAddress) errors.push("missing-token");
  else if (!parseAddress(rawTokenAddress)) errors.push("invalid-token");
  if (!rawChainId) errors.push("missing-chain-id");
  else if (Number(rawChainId) !== DEMO_V1_CHAIN_ID) errors.push("invalid-chain-id");
  if (!rawRpcUrl) errors.push("missing-rpc");
  else {
    try {
      const url = new URL(rawRpcUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)
      ) {
        errors.push("invalid-rpc");
      }
    } catch {
      errors.push("invalid-rpc");
    }
  }
  return errors;
}

export const demoV1Config = {
  chainId: DEMO_V1_CHAIN_ID,
  contractAddress: parseAddress(rawContractAddress),
  tokenAddress: parseAddress(rawTokenAddress),
  rpcUrl: rawRpcUrl,
  errors: validate(),
} as const;

export const isDemoV1Configured = demoV1Config.errors.length === 0;

export function getDemoV1ConfigErrorMessage(): string | null {
  if (isDemoV1Configured) return null;
  return `Demo V1 configuration error: ${demoV1Config.errors.join(", ")}.`;
}
