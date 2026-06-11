import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { connectWallet, disconnectWallet, getStxAddress } from "../lib/stacks";

interface WalletContextValue {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  // Initialise from connect's persisted session (the only storage we read).
  const [address, setAddress] = useState<string | null>(() => getStxAddress());
  const [connecting, setConnecting] = useState(false);

  // Re-sync on mount in case the session was established in another tab.
  useEffect(() => {
    const a = getStxAddress();
    if (a !== address) setAddress(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const a = await connectWallet();
      setAddress(a);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectWallet();
    setAddress(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({ address, connected: address !== null, connecting, connect, disconnect }),
    [address, connecting, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
