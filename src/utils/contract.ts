// src/utils/contract.ts

import { isAddress } from "viem";

const configuredAddress = import.meta.env.VITE_POP33_CONTRACT_ADDRESS?.trim();

export const POP33_CONTRACT_CONFIG_ERROR = !configuredAddress
  ? "missing"
  : !isAddress(configuredAddress)
    ? "invalid"
    : null;

export const POP33_ADDRESS = POP33_CONTRACT_CONFIG_ERROR
  ? undefined
  : (configuredAddress as `0x${string}`);

// Minimalne ABI kontraktu Pop33DemoV2 – tylko to, czego potrzebujemy w UI.
export const POP33_ABI = [
  // --- GŁÓWNA FUNKCJA JOIN DEMO ---
  {
    type: "function",
    name: "openNextAndJoin",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },

  // --- STATYSTYKI GLOBALNE ---
  {
    type: "function",
    name: "totalJoins",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  {
    type: "function",
    name: "getCurrentCycleId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // --- STATYSTYKI DLA UŻYTKOWNIKA ---
  {
    type: "function",
    name: "getActiveCyclesCount",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },

  {
    type: "function",
    name: "getUserCycles",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },

  // --- DANE O CYKLU ---
  {
    type: "function",
    name: "getCycle",
    stateMutability: "view",
    inputs: [{ name: "cycleId", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "openedAt", type: "uint256" },
      { name: "participantsCount", type: "uint256" },
      { name: "isOpen", type: "bool" },
    ],
  },

  {
    type: "function",
    name: "getCycleParticipants",
    stateMutability: "view",
    inputs: [{ name: "cycleId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const;
