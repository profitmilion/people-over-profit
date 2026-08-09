import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "./Button";
import { useMiniAppEnvironment } from "../hooks/useMiniAppEnvironment";

function shorten(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export function ConnectButton() {
  const { address, isConnected, isConnecting } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const isMiniApp = useMiniAppEnvironment();

  // Preferuj wstrzyknięty portfel (MetaMask/Rabby), w przeciwnym razie pierwszy dostępny
  const connector = isMiniApp
    ? connectors.find((candidate) => candidate.id === "farcaster")
    : connectors.find((candidate) => candidate.id === "injected");

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--text-dim)]">{shorten(address)}</span>
        <Button variant="ghost" onClick={() => disconnect()}>Disconnect</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={() => connector && connect({ connector })}
        disabled={isConnecting || isPending || !connector}
      >
        {isConnecting || isPending ? "Connecting..." : "Connect Wallet"}
      </Button>
      {error ? <span className="text-xs text-red-400">Connection error</span> : null}
    </div>
  );
}
