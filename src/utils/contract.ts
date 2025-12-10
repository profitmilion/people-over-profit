// src/utils/contract.ts

export const POP33_ADDRESS = "0x8Ada9bFA520fac6C3BF3e3790263ACdfdC1D1f3d"
;

// Tymczasowo możesz zostawić stare ABI – za chwilę je zaktualizujemy
export const POP33_ABI = [
  {
    type: "function",
    name: "joinFIFO",
    stateMutability: "payable",
    inputs: [],
    outputs: [{ name: "cycleId", type: "uint256" }],
  },
  {
    type: "function",
    name: "openNextAndJoin",
    stateMutability: "payable",
    inputs: [],
    outputs: [{ name: "cycleId", type: "uint256" }],
  },
  {
    type: "function",
    name: "drawWinner",
    stateMutability: "nonpayable",
    inputs: [{ name: "cycleId", type: "uint256" }],
    outputs: [{ name: "winner", type: "address" }],
  },
] as const;
