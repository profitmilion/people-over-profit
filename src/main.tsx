// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import { WagmiProvider } from "wagmi";
import { config } from "./wagmi";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./index.css";
import { signalFarcasterReady } from "./farcaster";

// Tworzymy klienta dla react-query (wagmi v2 z niego korzysta)
const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);

void signalFarcasterReady();
