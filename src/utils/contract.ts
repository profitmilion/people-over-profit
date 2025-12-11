// src/utils/contract.ts

// Adres aktualnie zdeployowanego kontraktu Pop33DemoV2 na Base Sepolia
export const POP33_ADDRESS =
  "0x9f55436afeb8B8F8E1495bD0Cd6052e233FBc966";

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

  // --- DEMO „LOSOWANIA” (na razie stub) ---
  {
    type: "function",
    name: "runDraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "cycleId", type: "uint256" }],
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
