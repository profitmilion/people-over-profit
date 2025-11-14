import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [baseSepolia],
  connectors: [
    injected({ shimDisconnect: true }), // MetaMask lub kompatybilne portfele
  ],
  transports: {
    [baseSepolia.id]: http("https://sepolia.base.org"),
  },
});
