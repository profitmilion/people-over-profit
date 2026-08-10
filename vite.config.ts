import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

function parseConfiguredPublicOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const url = new URL(value);
  const isLocalHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !isLocalHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "VITE_POP33_PUBLIC_URL must be an HTTPS origin without credentials, path, query, or hash.",
    );
  }

  return url.origin;
}

const configuredPublicOrigin = parseConfiguredPublicOrigin(
  process.env.VITE_POP33_PUBLIC_URL,
);
if (process.env.VERCEL_ENV === "production" && !configuredPublicOrigin) {
  throw new Error(
    "VITE_POP33_PUBLIC_URL is required for Vercel Production builds.",
  );
}

const vercelPreviewHost =
  process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
const publicUrl =
  configuredPublicOrigin ??
  (vercelPreviewHost
    ? `https://${vercelPreviewHost}`
    : "http://localhost:5173");

const previewAssociationDomain =
  "pop33-demo-git-codex-pop33-farcas-b58381-profitmilions-projects.vercel.app";
const previewAccountAssociation = {
  header:
    "eyJmaWQiOjEzNzc1MjYsInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHg4QzM2NTcyNTI2OWI5NTMxYkQwNTI3NTE1OGU1NTg2N2QxNUE5NWE3In0",
  payload:
    "eyJkb21haW4iOiJwb3AzMy1kZW1vLWdpdC1jb2RleC1wb3AzMy1mYXJjYXMtYjU4MzgxLXByb2ZpdG1pbGlvbnMtcHJvamVjdHMudmVyY2VsLmFwcCJ9",
  signature:
    "oDrEkAoRyQy3uxpRBDXjwo0dUEpkPxenOlUvtEnEsWk52tNPGNWyt9lqF4fovTvwm0shfwmgbhql9/bLt0YPzBs=",
};

const farcasterManifest = {
  ...(new URL(publicUrl).hostname === previewAssociationDomain
    ? { accountAssociation: previewAccountAssociation }
    : {}),
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
