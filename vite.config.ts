import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const vercelHost = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
const publicUrl = vercelHost ? `https://${vercelHost}` : "http://localhost:5173";

const farcasterManifest = {
  miniapp: {
    version: "1",
    name: "POP33 Public Alpha",
    homeUrl: `${publicUrl}/#/demo-v1`,
    iconUrl: `${publicUrl}/farcaster/icon-1024.png`,
    splashImageUrl: `${publicUrl}/farcaster/icon-1024.png`,
    splashBackgroundColor: "#020617",
    subtitle: "10-user Base Sepolia pilot",
    description:
      "Test POP33 pools with test tokens on Base Sepolia. Public alpha only; no real funds or prizes.",
    primaryCategory: "finance",
    tags: ["base", "testnet", "pools"],
    heroImageUrl: `${publicUrl}/farcaster/embed-3x2.png`,
    tagline: "Fill a 10-user test pool",
    ogTitle: "POP33 Public Alpha",
    ogDescription: "A 10-user Base Sepolia pool pilot using test tokens only.",
    ogImageUrl: `${publicUrl}/farcaster/embed-3x2.png`,
    requiredChains: ["eip155:84532"],
    requiredCapabilities: ["wallet.getEthereumProvider"],
  },
};

const publicUrlPlugin: Plugin = {
  name: "pop33-public-url",
  transformIndexHtml(html: string) {
    return html.replaceAll("__POP33_PUBLIC_URL__", publicUrl);
  },
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: ".well-known/farcaster.json",
      source: `${JSON.stringify(farcasterManifest, null, 2)}\n`,
    });
  },
};

export default defineConfig({
  plugins: [react(), publicUrlPlugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
