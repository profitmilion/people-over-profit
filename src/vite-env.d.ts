/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POP33_DEMO_V1_CONTRACT_ADDRESS?: string;
  readonly VITE_POP33_DEMO_V1_TOKEN_ADDRESS?: string;
  readonly VITE_POP33_DEMO_V1_CHAIN_ID?: string;
  readonly VITE_POP33_DEMO_V1_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
