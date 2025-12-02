// src/config/pop33Config.ts

export type Pop33Mode = "demo" | "prod";

type Pop33Settings = {
  mode: Pop33Mode;
  entryCost: number;
  maxEntries: number;
  initialPoints: number;
  isOnchainEnabled: boolean;
  networkName: string;
};

export const DEMO_SETTINGS: Pop33Settings = {
  mode: "demo",
  entryCost: 33,
  maxEntries: 10,
  initialPoints: 1000,
  isOnchainEnabled: false,
  networkName: "Sepolia testnet",
};

export const PROD_SETTINGS: Pop33Settings = {
  mode: "prod",
  entryCost: 33,
  maxEntries: 10,
  initialPoints: 0,
  isOnchainEnabled: true,
  networkName: "Base mainnet",
};
