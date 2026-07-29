import { useEffect, useMemo, useState } from "react";
import { useConnect, useSwitchChain } from "wagmi";
import { Button } from "./Button";
import { formatCountdown } from "../demo-v1/domain";
import {
  BASE_SEPOLIA_CHAIN_ID,
  getDemoOnboardingState,
  getWalletRequestErrorMessage,
} from "../demo-v1/onboarding";
import type { useDemoV1Actions } from "../hooks/useDemoV1Actions";
import type { useDemoV1Data } from "../hooks/useDemoV1Data";

const BASE_SEPOLIA_FAUCETS_URL =
  "https://docs.base.org/base-chain/network-information/network-faucets";

type DemoV1OnboardingProps = {
  data: ReturnType<typeof useDemoV1Data>;
  actions: ReturnType<typeof useDemoV1Actions>;
  now: number;
  faucetAvailable: boolean;
  joinEligible: boolean;
  positionCapacityAvailable: boolean;
};

const checkStyles = {
  complete: {
    icon: "✓",
    wrapper: "border-emerald-800/70 bg-emerald-950/25",
    iconClass: "bg-emerald-500 text-slate-950",
  },
  current: {
    icon: "→",
    wrapper: "border-amber-600/80 bg-amber-950/35",
    iconClass: "bg-amber-400 text-slate-950",
  },
  blocked: {
    icon: "·",
    wrapper: "border-slate-800 bg-slate-950/50",
    iconClass: "bg-slate-800 text-slate-400",
  },
} as const;

export function DemoV1Onboarding({
  data,
  actions,
  now,
  faucetAvailable,
  joinEligible,
  positionCapacityAvailable,
}: DemoV1OnboardingProps) {
  const {
    connectAsync,
    connectors,
    error: connectError,
    isPending: isConnecting,
    reset: resetConnect,
  } = useConnect();
  const {
    switchChainAsync,
    error: switchError,
    isPending: isSwitching,
    reset: resetSwitch,
  } = useSwitchChain();
  const injectedConnector = connectors.find((connector) => connector.id === "injected");
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    if (!injectedConnector) {
      setProviderAvailable(false);
      return () => {
        active = false;
      };
    }
    void injectedConnector
      .getProvider()
      .then((provider) => {
        if (active) setProviderAvailable(Boolean(provider));
      })
      .catch(() => {
        if (active) setProviderAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [injectedConnector]);

  const hasWalletProvider = data.isConnected || providerAvailable !== false;
  const onboarding = useMemo(
    () =>
      getDemoOnboardingState({
        hasWalletProvider,
        isConnected: data.isConnected,
        chainId: data.chainId,
        isNetworkPending: isSwitching,
        nativeBalance: data.nativeBalance,
        tokenBalance: data.tokenBalance,
        allowance: data.allowance,
        entryPrice: data.staticData.entryPrice,
        faucetAvailable,
        runtimeReady: data.runtimeIdentityVerified && !data.isLoading && !data.error,
        positionCapacityAvailable,
        joinEligible,
        transactionBusy: actions.isBusy,
      }),
    [
      actions.isBusy,
      data.allowance,
      data.chainId,
      data.error,
      data.isConnected,
      data.isLoading,
      data.nativeBalance,
      data.runtimeIdentityVerified,
      data.staticData.entryPrice,
      data.tokenBalance,
      faucetAvailable,
      hasWalletProvider,
      isSwitching,
      joinEligible,
      positionCapacityAvailable,
    ],
  );

  const requestError =
    getWalletRequestErrorMessage(connectError, "connect") ??
    getWalletRequestErrorMessage(switchError, "network");

  const run = (operation: Promise<unknown>) => {
    void operation.catch(() => undefined);
  };

  const primaryAction = (() => {
    switch (onboarding.nextAction) {
      case "connect-wallet":
        return (
          <Button
            className="min-h-11 w-full text-base"
            disabled={isConnecting || !injectedConnector || providerAvailable === false}
            onClick={() => {
              resetConnect();
              if (injectedConnector) run(connectAsync({ connector: injectedConnector }));
            }}
          >
            {isConnecting ? "Łączenie z portfelem…" : "Connect wallet"}
          </Button>
        );
      case "switch-network":
        return (
          <Button
            className="min-h-11 w-full text-base"
            disabled={isSwitching}
            onClick={() => {
              resetSwitch();
              run(switchChainAsync({ chainId: BASE_SEPOLIA_CHAIN_ID }));
            }}
          >
            {isSwitching ? "Dodawanie lub przełączanie…" : "Switch to Base Sepolia"}
          </Button>
        );
      case "get-test-eth":
        return (
          <a
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--gold)] px-4 py-2 text-center text-base font-semibold text-black transition hover:bg-yellow-400"
            href={BASE_SEPOLIA_FAUCETS_URL}
            target="_blank"
            rel="noreferrer"
          >
            Get test ETH · oficjalna lista Base
          </a>
        );
      case "get-dusdc":
        return (
          <Button
            className="min-h-11 w-full text-base"
            disabled={actions.isBusy}
            onClick={() => run(actions.drip())}
          >
            Get test dUSDC
          </Button>
        );
      case "approve":
        return (
          <Button
            className="min-h-11 w-full text-base"
            disabled={actions.isBusy}
            onClick={() => run(actions.approveExact())}
          >
            Approve 33 dUSDC
          </Button>
        );
      case "join":
        return (
          <Button
            variant="pop"
            className="min-h-11 w-full rounded-xl px-4 py-2 text-base"
            disabled={actions.isBusy}
            onClick={() => run(actions.join())}
          >
            Join pool
          </Button>
        );
      case "wait-for-faucet":
        return (
          <Button className="min-h-11 w-full text-base" disabled>
            Faucet: {formatCountdown(data.nextDripAt, now)}
          </Button>
        );
      case "review-allowance":
        return (
          <Button className="min-h-11 w-full text-base" disabled>
            Join zablokowany — sprawdź allowance
          </Button>
        );
      case "open-wallet-browser":
        return (
          <div className="rounded-xl border border-sky-800 bg-sky-950/40 p-3 text-sm leading-relaxed text-sky-100">
            Skopiuj adres tej strony i otwórz go w zakładce przeglądarki wewnątrz
            MetaMask lub kompatybilnego portfela. Nie wpisuj nigdzie seed phrase ani
            private key.
          </div>
        );
      case "wait":
        return (
          <Button className="min-h-11 w-full text-base" disabled>
            {actions.isBusy ? "Operacja w toku…" : "Czekamy na bezpieczne odczyty…"}
          </Button>
        );
    }
  })();

  return (
    <section
      className="overflow-hidden rounded-2xl border border-emerald-700/70 bg-slate-900/95 p-3 shadow-lg shadow-emerald-950/30 sm:p-5"
      aria-labelledby="demo-readiness-title"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
            Pierwsze kroki
          </div>
          <h2 id="demo-readiness-title" className="mt-1 text-xl font-semibold">
            Przygotowanie do Demo
          </h2>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs leading-relaxed text-slate-300 sm:max-w-xs">
          Base Sepolia ETH płaci tylko za gas. dUSDC służy tylko do testowania
          POP33. Oba aktywa są testowe i nie mają rzeczywistej wartości.
        </div>
      </div>

      <ol className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {onboarding.checks.map((check) => {
          const styles = checkStyles[check.status];
          return (
            <li
              key={check.id}
              className={`min-w-0 rounded-xl border p-3 ${styles.wrapper}`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${styles.iconClass}`}
                  aria-hidden="true"
                >
                  {styles.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-100">{check.label}</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-400">
                    {check.detail}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 rounded-xl border border-amber-700/70 bg-amber-950/30 p-3 sm:p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-300">
          Najważniejsza następna czynność
        </div>
        <div className="mt-1 text-base font-semibold text-amber-50">{onboarding.title}</div>
        <p className="mt-1 text-sm leading-relaxed text-amber-100/80">
          {onboarding.description}
        </p>
        <div className="mt-3 w-full">{primaryAction}</div>
      </div>

      {requestError ? (
        <div
          className="mt-3 rounded-xl border border-red-700 bg-red-950/40 p-3 text-sm leading-relaxed text-red-100"
          role="alert"
        >
          {requestError}
        </div>
      ) : null}
    </section>
  );
}
