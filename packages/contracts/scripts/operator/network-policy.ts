export const OPERATOR_MODES = [
  "preflight",
  "status",
  "fund",
  "drip",
  "approve",
  "join-to-99",
  "final-join",
  "withdraw-all-before-lock",
  "draw-next",
  "claim-finalized",
] as const;

export type OperatorMode = (typeof OPERATOR_MODES)[number];
export type OperatorNetwork = "hardhatOp" | "baseSepolia";

export const BASE_SEPOLIA_WRITE_CONFIRMATION =
  "I UNDERSTAND POP33 WILL WRITE TO BASE SEPOLIA";

const READ_ONLY_MODES = new Set<OperatorMode>(["preflight", "status"]);

export interface ExecutionPolicyInput {
  mode: OperatorMode;
  network: OperatorNetwork;
  executePublic?: boolean;
  confirmation?: string;
}

export function isWriteMode(mode: OperatorMode): boolean {
  return !READ_ONLY_MODES.has(mode);
}

export function assertExecutionPolicy(input: ExecutionPolicyInput): void {
  if (input.network === "hardhatOp" || !isWriteMode(input.mode)) return;

  if (!input.executePublic) {
    throw new Error(
      "Base Sepolia write blocked: the separate public execution flag is missing.",
    );
  }
  if (input.confirmation !== BASE_SEPOLIA_WRITE_CONFIRMATION) {
    throw new Error(
      "Base Sepolia write blocked: the exact confirmation phrase is missing.",
    );
  }

  throw new Error(
    "Base Sepolia write blocked: public write execution is not implemented in this operator version.",
  );
}
