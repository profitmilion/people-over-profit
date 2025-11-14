// src/utils/contract.ts
// Minimalny szkielet na teraz — żeby importy w CycleActions/LiveDraw działały.
// Podmienisz adres i ABI na prawdziwe, gdy będziemy łączyć kontrakt.

export const POP33_ADDRESS = "0x0000000000000000000000000000000000000000";

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
