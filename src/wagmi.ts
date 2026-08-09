import { createConfig, http } from "wagmi";
import { fallback } from "viem";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";

// używamy RPC z .env zamiast na sztywno
const LEGACY_RPC_URL = import.meta.env.VITE_POP33_RPC_URL || "https://sepolia.base.org";
const DEMO_V1_RPC_URL =
  import.meta.env.VITE_POP33_DEMO_V1_RPC_URL || LEGACY_RPC_URL;

export const config = createConfig({
  chains: [baseSepolia],
  connectors: [
    farcasterMiniApp(),
    injected(),
  ],

  transports: {
    [baseSepolia.id]: fallback([
      http(DEMO_V1_RPC_URL),
      http(LEGACY_RPC_URL),
    ]),
  },
});
