import { createHash } from "node:crypto";

import { getAddress, isAddress } from "ethers";

export const PILOT_SET_PROJECT = "POP33";
export const PILOT_SET_PURPOSE = "base-sepolia-operator-pilot";
export const PILOT_SET_CHAIN_ID = 84_532n;
export const PILOT_SET_WALLET_COUNT = 5;
export const PILOT_SET_CONTRACT_ADDRESS = getAddress(
  "0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F",
);
export const PILOT_SET_TOKEN_ADDRESS = getAddress(
  "0xA7FA084b34c888061757d4b5FBb08a7B53fee786",
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;
export const OPERATOR_SET_MANIFEST_SUFFIX = ".operator-set-manifest.json";

export interface OperatorSetBinding {
  bindingVersion: 1;
  project: typeof PILOT_SET_PROJECT;
  purpose: typeof PILOT_SET_PURPOSE;
  chainId: string;
  walletCount: number;
  contractAddress: string;
  tokenAddress: string;
  storeId: string;
  walletOrderDigest: string;
}

export interface OperatorSetManifest {
  formatVersion: 1;
  createdAt: string;
  binding: OperatorSetBinding;
  walletAddresses: string[];
  files: {
    walletStore: string;
    checkpoint: string;
    transactionJournal: string;
    manifest: string;
  };
}

const BINDING_KEYS = [
  "bindingVersion", "project", "purpose", "chainId", "walletCount",
  "contractAddress", "tokenAddress", "storeId", "walletOrderDigest",
] as const;
const MANIFEST_KEYS = ["formatVersion", "createdAt", "binding", "walletAddresses", "files"] as const;
const FILE_KEYS = ["walletStore", "checkpoint", "transactionJournal", "manifest"] as const;

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new Error(`${label}.${key} is not allowed.`);
  }
  for (const key of keys) {
    if (!(key in record)) throw new Error(`${label}.${key} is required.`);
  }
  return record;
}

function requireIso(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function requireFileName(value: unknown, suffix: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("/") ||
    value.includes("\\") ||
    value === "." ||
    value === ".." ||
    !value.toLowerCase().endsWith(suffix)
  ) {
    throw new Error(`${label} must be a relative file name ending with ${suffix}.`);
  }
  return value;
}

export function walletOrderDigest(addresses: readonly string[]): string {
  const canonical = addresses.map((address) => getAddress(address).toLowerCase()).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("base64");
}

export function createPilotSetBinding(storeId: string, addresses: readonly string[]): OperatorSetBinding {
  if (!UUID.test(storeId)) throw new Error("Pilot wallet store ID must be a UUID.");
  if (addresses.length !== PILOT_SET_WALLET_COUNT) {
    throw new Error(`Pilot set must contain exactly ${PILOT_SET_WALLET_COUNT} wallets.`);
  }
  const normalized = addresses.map((address) => getAddress(address));
  if (new Set(normalized.map((address) => address.toLowerCase())).size !== normalized.length) {
    throw new Error("Pilot set contains duplicate wallet addresses.");
  }
  return {
    bindingVersion: 1,
    project: PILOT_SET_PROJECT,
    purpose: PILOT_SET_PURPOSE,
    chainId: PILOT_SET_CHAIN_ID.toString(),
    walletCount: PILOT_SET_WALLET_COUNT,
    contractAddress: PILOT_SET_CONTRACT_ADDRESS,
    tokenAddress: PILOT_SET_TOKEN_ADDRESS,
    storeId,
    walletOrderDigest: walletOrderDigest(normalized),
  };
}

export function validateOperatorSetBinding(value: unknown): OperatorSetBinding {
  const binding = exactObject(value, BINDING_KEYS, "operatorSet.binding");
  if (binding.bindingVersion !== 1) throw new Error("Operator set binding version must equal 1.");
  if (binding.project !== PILOT_SET_PROJECT) throw new Error("Operator set project mismatch.");
  if (binding.purpose !== PILOT_SET_PURPOSE) throw new Error("Operator set purpose mismatch.");
  if (binding.chainId !== PILOT_SET_CHAIN_ID.toString()) throw new Error("Operator set chain ID mismatch.");
  if (binding.walletCount !== PILOT_SET_WALLET_COUNT) throw new Error("Operator set wallet count mismatch.");
  if (typeof binding.contractAddress !== "string" || !isAddress(binding.contractAddress) ||
      getAddress(binding.contractAddress) !== PILOT_SET_CONTRACT_ADDRESS) {
    throw new Error("Operator set contract address mismatch.");
  }
  if (typeof binding.tokenAddress !== "string" || !isAddress(binding.tokenAddress) ||
      getAddress(binding.tokenAddress) !== PILOT_SET_TOKEN_ADDRESS) {
    throw new Error("Operator set token address mismatch.");
  }
  if (typeof binding.storeId !== "string" || !UUID.test(binding.storeId)) {
    throw new Error("Operator set store ID is invalid.");
  }
  if (typeof binding.walletOrderDigest !== "string" || !BASE64_SHA256.test(binding.walletOrderDigest)) {
    throw new Error("Operator set wallet-order digest is invalid.");
  }
  return binding as unknown as OperatorSetBinding;
}

export function assertMatchingOperatorSetBindings(
  expected: OperatorSetBinding,
  candidate: unknown,
  label: string,
): void {
  const actual = validateOperatorSetBinding(candidate);
  for (const key of BINDING_KEYS) {
    if (actual[key] !== expected[key]) throw new Error(`${label} binding mismatch at ${key}.`);
  }
}

export function validateOperatorSetManifest(value: unknown): OperatorSetManifest {
  const manifest = exactObject(value, MANIFEST_KEYS, "operatorSet.manifest");
  if (manifest.formatVersion !== 1) throw new Error("Operator set manifest version must equal 1.");
  const createdAt = requireIso(manifest.createdAt, "operatorSet.manifest.createdAt");
  const binding = validateOperatorSetBinding(manifest.binding);
  if (!Array.isArray(manifest.walletAddresses) || manifest.walletAddresses.length !== binding.walletCount) {
    throw new Error("Operator set manifest wallet count mismatch.");
  }
  const walletAddresses = manifest.walletAddresses.map((address, index) => {
    if (typeof address !== "string" || !isAddress(address)) {
      throw new Error(`Operator set manifest wallet ${index} is invalid.`);
    }
    return getAddress(address);
  });
  if (new Set(walletAddresses.map((address) => address.toLowerCase())).size !== walletAddresses.length) {
    throw new Error("Operator set manifest contains duplicate wallets.");
  }
  if (walletOrderDigest(walletAddresses) !== binding.walletOrderDigest) {
    throw new Error("Operator set manifest wallet order does not match its binding.");
  }
  const files = exactObject(manifest.files, FILE_KEYS, "operatorSet.manifest.files");
  return {
    formatVersion: 1,
    createdAt,
    binding,
    walletAddresses,
    files: {
      walletStore: requireFileName(files.walletStore, ".operator-wallets.enc.json", "walletStore"),
      checkpoint: requireFileName(files.checkpoint, ".operator-checkpoint.json", "checkpoint"),
      transactionJournal: requireFileName(files.transactionJournal, ".operator-journal.json", "transactionJournal"),
      manifest: requireFileName(files.manifest, OPERATOR_SET_MANIFEST_SUFFIX, "manifest"),
    },
  };
}
