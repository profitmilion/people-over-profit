import { getAddress } from "viem";
import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
  DEMO_V1_TOKEN_ADDRESS,
  parseDemoV1Address,
  validateDemoV1PublicConfig,
} from "./safety";

export { DEMO_V1_CHAIN_ID, DEMO_V1_CONTRACT_ADDRESS, DEMO_V1_TOKEN_ADDRESS };
export const DEMO_V1_DEPLOYER = getAddress(
  "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB",
);

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

export const demoV1Config = {
  chainId: DEMO_V1_CHAIN_ID,
  contractAddress: parseDemoV1Address(rawContractAddress),
  tokenAddress: parseDemoV1Address(rawTokenAddress),
  rpcUrl: rawRpcUrl,
  errors: validateDemoV1PublicConfig({
    contractAddress: rawContractAddress,
    tokenAddress: rawTokenAddress,
    chainId: rawChainId,
    rpcUrl: rawRpcUrl,
  }),
} as const;

export const isDemoV1Configured = demoV1Config.errors.length === 0;

export function getDemoV1ConfigErrorMessage(): string | null {
  if (isDemoV1Configured) return null;
  return `Demo V1 configuration error: ${demoV1Config.errors.join(", ")}.`;
}
