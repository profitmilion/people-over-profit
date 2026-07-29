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
    title = "Otwórz Demo w portfelu Web3";
    description =
      "Na telefonie otwórz ten link we wbudowanej przeglądarce MetaMask lub innego kompatybilnego portfela.";
  } else if (!input.isConnected) {
    nextAction = "connect-wallet";
    title = "Połącz portfel testowy";
    description =
      "Połączenie portfela nic nie kosztuje. Wybierz osobne konto bez prawdziwych środków.";
  } else if (!correctChain) {
    nextAction = "switch-network";
    title = input.isNetworkPending
      ? "Przełączanie lub dodawanie Base Sepolia"
      : "Przełącz sieć na Base Sepolia";
    description = input.isNetworkPending
      ? "Potwierdź w portfelu dodanie Base Sepolia, jeśli zostaniesz o to poproszony, a następnie zmianę sieci."
      : `Demo działa wyłącznie na Base Sepolia (chain ID ${BASE_SEPOLIA_CHAIN_ID}).`;
  } else if (input.transactionBusy) {
    nextAction = "wait";
    title = "Poczekaj na zakończenie operacji";
    description =
      "Nie wysyłaj kolejnej transakcji, dopóki bieżąca operacja nie zostanie potwierdzona i sprawdzona.";
  } else if (!hasRecommendedEth) {
    nextAction = "get-test-eth";
    title = input.nativeBalance === 0n
      ? "Pobierz testowy Base Sepolia ETH"
      : "Uzupełnij testowy Base Sepolia ETH";
    description =
      "ETH służy tylko do opłat sieciowych. Zalecane minimum dla pierwszego testu to 0.00005 testowego ETH.";
  } else if (!input.runtimeReady) {
    nextAction = "wait";
    title = "Sprawdzamy kontrakt Demo";
    description =
      "Czekamy na bezpieczne odczyty Base Sepolia i potwierdzenie parametrów wdrożonego Demo V1.";
  } else if (!hasDUsdc) {
    if (input.faucetAvailable) {
      nextAction = "get-dusdc";
      title = "Pobierz testowy dUSDC";
      description =
        "dUSDC służy wyłącznie do testowania POP33. Transakcja faucetu również zużyje niewielką ilość testowego ETH.";
    } else {
      nextAction = "wait-for-faucet";
      title = "Poczekaj na ponowne otwarcie faucetu dUSDC";
      description =
        "Ten portfel jest jeszcze w okresie cooldownu i nie ma 33 dUSDC potrzebnych do wejścia.";
    }
  } else if (!input.positionCapacityAvailable) {
    nextAction = "wait";
    title = "Osiągnięto limit aktywnych pozycji";
    description =
      "Ten portfel ma już maksymalną liczbę aktywnych pozycji. Nie wykonuj kolejnego approval ani Join.";
  } else if (!safeAllowance) {
    nextAction = "review-allowance";
    title = "Zatrzymaj się i sprawdź allowance";
    description =
      "Allowance jest wyższy niż dokładne 33 dUSDC. POP33 nie wykona automatycznego revoke ani Join — zgłoś ten stan do sprawdzenia.";
  } else if (!exactAllowance) {
    nextAction = "approve";
    title = "Zatwierdź dokładnie 33 dUSDC";
    description =
      "Portfel poprosi o jedną transakcję approval. Po jej potwierdzeniu wróć do checklisty, aby wykonać osobny Join.";
  } else if (!input.joinEligible) {
    nextAction = "wait";
    title = "Odświeżamy gotowość do Join";
    description =
      "Join pozostaje zablokowany, dopóki wszystkie odczyty kontraktu i warunki bezpieczeństwa nie będą poprawne.";
  } else {
    nextAction = "join";
    title = "Portfel jest gotowy do Join";
    description =
      "Sprawdź w portfelu sieć Base Sepolia i adres kontraktu, a następnie potwierdź jedną transakcję Join.";
  }

  const checks: DemoOnboardingCheck[] = [
    {
      id: "wallet",
      label: "Portfel Web3",
      detail: input.isConnected
        ? "Portfel testowy jest połączony."
        : input.hasWalletProvider
          ? "Portfel jest dostępny, ale jeszcze niepołączony."
          : "Nie wykryto portfela w tej przeglądarce.",
      status: checkStatus(input.isConnected, nextAction === "connect-wallet" || nextAction === "open-wallet-browser"),
    },
    {
      id: "network",
      label: "Base Sepolia · 84532",
      detail: correctChain
        ? "Aktywna sieć jest poprawna."
        : input.isConnected
          ? `Aktywny chain ID: ${input.chainId ?? "nieznany"}.`
          : "Sieć sprawdzimy po połączeniu portfela.",
      status: checkStatus(correctChain, nextAction === "switch-network"),
    },
    {
      id: "eth",
      label: "Testowy ETH na opłaty",
      detail: hasRecommendedEth
        ? "Saldo osiąga zalecane minimum 0.00005 ETH."
        : input.nativeBalance > 0n
          ? "Saldo jest niezerowe, ale niższe od zalecanego minimum."
          : "Brak Base Sepolia ETH.",
      status: checkStatus(hasRecommendedEth, nextAction === "get-test-eth"),
    },
    {
      id: "dusdc",
      label: "Minimum 33 testowe dUSDC",
      detail: hasDUsdc
        ? "Saldo wystarcza na jedną pozycję."
        : "Pobierz dUSDC z faucetu POP33.",
      status: checkStatus(hasDUsdc, nextAction === "get-dusdc" || nextAction === "wait-for-faucet"),
    },
    {
      id: "allowance",
      label: "Bezpieczny allowance",
      detail: !safeAllowance
        ? "Allowance przekracza dokładne 33 dUSDC."
        : exactAllowance
          ? "Allowance wynosi dokładnie 33 dUSDC."
          : "Allowance jest bezpieczny; przed Join potrzebny jest dokładny approval.",
      status: checkStatus(safeAllowance && exactAllowance, nextAction === "approve" || nextAction === "review-allowance"),
    },
    {
      id: "join",
      label: "Gotowość do Join",
      detail: readyToJoin
        ? "Wszystkie warunki są spełnione."
        : "Join odblokuje się po wykonaniu wcześniejszych kroków.",
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
  const text = `${candidate.name ?? ""} ${candidate.shortMessage ?? ""} ${candidate.message ?? ""}`.toLowerCase();
  const rejected =
    candidate.code === 4001 ||
    text.includes("user rejected") ||
    text.includes("user denied") ||
    text.includes("rejected request");
  if (rejected) {
    return action === "connect"
      ? "Połączenie zostało odrzucone w portfelu. Możesz spróbować ponownie, gdy wybierzesz właściwe konto testowe."
      : "Zmiana lub dodanie Base Sepolia zostało odrzucone w portfelu. Żadna transakcja nie została wysłana.";
  }
  if (text.includes("provider") && (text.includes("not found") || text.includes("unavailable"))) {
    return "Nie znaleziono dostawcy portfela. Na telefonie otwórz stronę we wbudowanej przeglądarce MetaMask lub kompatybilnego portfela.";
  }
  return action === "connect"
    ? "Nie udało się połączyć portfela. Sprawdź, czy strona jest otwarta w przeglądarce portfela i spróbuj ponownie."
    : "Nie udało się przełączyć ani dodać Base Sepolia. Sprawdź w portfelu chain ID 84532 i spróbuj ponownie.";
}
