export const BASE_SEPOLIA_CHAIN_ID = 84_532;
export const RECOMMENDED_DEMO_ETH_BALANCE = 50_000_000_000_000n;

export type DemoOnboardingAction =
  | "open-wallet-browser"
  | "connect-wallet"
  | "switch-network"
  | "get-test-eth"
  | "get-dusdc"
  | "wait-for-faucet"
  | "review-allowance"
  | "approve"
  | "join"
  | "wait";

export type DemoOnboardingCheckStatus = "complete" | "current" | "blocked";

export type DemoOnboardingCheck = {
  id: "wallet" | "network" | "eth" | "dusdc" | "allowance" | "join";
  label: string;
  detail: string;
  status: DemoOnboardingCheckStatus;
};

export type DemoOnboardingInput = {
  hasWalletProvider: boolean;
  isConnected: boolean;
  chainId?: number;
  isNetworkPending: boolean;
  nativeBalance: bigint;
  tokenBalance: bigint;
  allowance: bigint;
  entryPrice: bigint;
  faucetAvailable: boolean;
  runtimeReady: boolean;
  positionCapacityAvailable: boolean;
  joinEligible: boolean;
  transactionBusy: boolean;
};

export type DemoOnboardingState = {
  nextAction: DemoOnboardingAction;
  title: string;
  description: string;
  checks: readonly DemoOnboardingCheck[];
  readyToJoin: boolean;
};

function checkStatus(complete: boolean, current: boolean): DemoOnboardingCheckStatus {
  if (complete) return "complete";
  return current ? "current" : "blocked";
}

export function getDemoOnboardingState(
  input: DemoOnboardingInput,
): DemoOnboardingState {
  const correctChain = input.isConnected && input.chainId === BASE_SEPOLIA_CHAIN_ID;
  const hasRecommendedEth = input.nativeBalance >= RECOMMENDED_DEMO_ETH_BALANCE;
  const hasDUsdc = input.entryPrice > 0n && input.tokenBalance >= input.entryPrice;
  const safeAllowance = input.entryPrice > 0n && input.allowance <= input.entryPrice;
  const exactAllowance = input.entryPrice > 0n && input.allowance === input.entryPrice;
  const readyToJoin =
    input.hasWalletProvider &&
    input.isConnected &&
    correctChain &&
    hasRecommendedEth &&
    hasDUsdc &&
    safeAllowance &&
    exactAllowance &&
    input.runtimeReady &&
    input.positionCapacityAvailable &&
    input.joinEligible &&
    !input.transactionBusy;

  let nextAction: DemoOnboardingAction;
  let title: string;
  let description: string;

  if (!input.hasWalletProvider) {
    nextAction = "open-wallet-browser";
    title = "Open the Demo in a Web3 wallet";
    description =
      "On mobile, open this link in MetaMask's built-in browser or another compatible wallet browser.";
  } else if (!input.isConnected) {
    nextAction = "connect-wallet";
    title = "Connect a test wallet";
    description =
      "Connecting is free. Use a separate test account without real funds.";
  } else if (!correctChain) {
    nextAction = "switch-network";
    title = input.isNetworkPending
      ? "Adding or switching to Base Sepolia"
      : "Switch to Base Sepolia";
    description = input.isNetworkPending
      ? "Confirm adding Base Sepolia in your wallet if prompted, then confirm the network switch."
      : `This Demo works only on Base Sepolia (chain ID ${BASE_SEPOLIA_CHAIN_ID}).`;
  } else if (input.transactionBusy) {
    nextAction = "wait";
    title = "Wait for the current action";
    description =
      "Do not send another transaction until the current action is confirmed and verified.";
  } else if (!hasRecommendedEth) {
    nextAction = "get-test-eth";
    title = input.nativeBalance === 0n
      ? "Get test Base Sepolia ETH"
      : "Top up test Base Sepolia ETH";
    description =
      "ETH is used only for network fees. The recommended minimum for the first test is 0.00005 test ETH.";
  } else if (!input.runtimeReady) {
    nextAction = "wait";
    title = "Checking the Demo contract";
    description =
      "Waiting for safe Base Sepolia reads and verification of the deployed Demo V1 parameters.";
  } else if (!hasDUsdc) {
    if (input.faucetAvailable) {
      nextAction = "get-dusdc";
      title = "Get test dUSDC";
      description =
        "dUSDC is only for testing POP33. The faucet transaction also uses a small amount of test ETH.";
    } else {
      nextAction = "wait-for-faucet";
      title = "Wait for the dUSDC faucet cooldown";
      description =
        "This wallet is still in its faucet cooldown and does not have the 33 dUSDC required to enter.";
    }
  } else if (!input.positionCapacityAvailable) {
    nextAction = "wait";
    title = "Active position limit reached";
    description =
      "This wallet already has the maximum number of active positions. Do not send another approval or Join.";
  } else if (!safeAllowance) {
    nextAction = "review-allowance";
    title = "Stop and review the allowance";
    description =
      "The allowance is higher than exactly 33 dUSDC. POP33 will not automatically revoke it or Join; report this state for review.";
  } else if (!exactAllowance) {
    nextAction = "approve";
    title = "Approve exactly 33 dUSDC";
    description =
      "Your wallet will ask for one approval transaction. After it confirms, return to the checklist for the separate Join transaction.";
  } else if (!input.joinEligible) {
    nextAction = "wait";
    title = "Refreshing Join readiness";
    description =
      "Join remains blocked until all contract reads and safety conditions are valid.";
  } else {
    nextAction = "join";
    title = "Your wallet is ready to Join";
    description =
      "Check Base Sepolia and the contract address in your wallet, then confirm one Join transaction.";
  }

  const checks: DemoOnboardingCheck[] = [
    {
      id: "wallet",
      label: "Web3 wallet",
      detail: input.isConnected
        ? "A test wallet is connected."
        : input.hasWalletProvider
          ? "A wallet is available but not connected yet."
          : "No wallet was detected in this browser.",
      status: checkStatus(input.isConnected, nextAction === "connect-wallet" || nextAction === "open-wallet-browser"),
    },
    {
      id: "network",
      label: "Base Sepolia · 84532",
      detail: correctChain
        ? "The active network is correct."
        : input.isConnected
          ? `Active chain ID: ${input.chainId ?? "unknown"}.`
          : "The network will be checked after the wallet connects.",
      status: checkStatus(correctChain, nextAction === "switch-network"),
    },
    {
      id: "eth",
      label: "Test ETH for gas",
      detail: hasRecommendedEth
        ? "The balance meets the recommended 0.00005 ETH minimum."
        : input.nativeBalance > 0n
          ? "The balance is non-zero but below the recommended minimum."
          : "No Base Sepolia ETH is available.",
      status: checkStatus(hasRecommendedEth, nextAction === "get-test-eth"),
    },
    {
      id: "dusdc",
      label: "At least 33 test dUSDC",
      detail: hasDUsdc
        ? "The balance is sufficient for one position."
        : "Get dUSDC from the POP33 faucet.",
      status: checkStatus(hasDUsdc, nextAction === "get-dusdc" || nextAction === "wait-for-faucet"),
    },
    {
      id: "allowance",
      label: "Safe allowance",
      detail: !safeAllowance
        ? "The allowance is higher than exactly 33 dUSDC."
        : exactAllowance
          ? "The allowance is exactly 33 dUSDC."
          : "The allowance is safe; an exact approval is required before Join.",
      status: checkStatus(safeAllowance && exactAllowance, nextAction === "approve" || nextAction === "review-allowance"),
    },
    {
      id: "join",
      label: "Ready to Join",
      detail: readyToJoin
        ? "All conditions are satisfied."
        : "Join will unlock after the earlier steps are complete.",
      status: checkStatus(readyToJoin, nextAction === "join" || nextAction === "wait"),
    },
  ];

  return { nextAction, title, description, checks, readyToJoin };
}

export function getWalletRequestErrorMessage(
  error: unknown,
  action: "connect" | "network",
): string | null {
  if (!error) return null;
  const candidate = error as {
    code?: number;
    name?: string;
    message?: string;
    shortMessage?: string;
  };
  const errorText = `${candidate.name ?? ""} ${candidate.shortMessage ?? ""} ${candidate.message ?? ""}`.toLowerCase();
  const rejected =
    candidate.code === 4001 ||
    errorText.includes("user rejected") ||
    errorText.includes("user denied") ||
    errorText.includes("rejected request");
  if (rejected) {
    return action === "connect"
      ? "The wallet connection was rejected. Try again when you have selected the correct test account."
      : "Adding or switching to Base Sepolia was rejected in the wallet. No transaction was sent.";
  }
  if (errorText.includes("provider") && (errorText.includes("not found") || errorText.includes("unavailable"))) {
    return "No wallet provider was found. On mobile, open this page in MetaMask's built-in browser or another compatible wallet browser.";
  }
  return action === "connect"
    ? "The wallet could not connect. Check that this page is open in a wallet browser and try again."
    : "Base Sepolia could not be added or selected. Check chain ID 84532 in your wallet and try again.";
}
