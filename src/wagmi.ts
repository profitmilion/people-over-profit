import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// używamy RPC z .env zamiast na sztywno
const RPC_URL = import.meta.env.VITE_POP33_RPC_URL || "https://sepolia.base.org";

export const config = createConfig({
  chains: [baseSepolia],
  connectors: [
    injected(),
  ],

  transports: {
    [baseSepolia.id]: http(RPC_URL),
  },
});
