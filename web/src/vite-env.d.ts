/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_STACKS_NETWORK?: "devnet" | "testnet" | "mainnet";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
