import { useEffect, useRef, useState } from "react";
import { useWallet } from "../hooks/useWallet";
import { truncateAddress } from "../lib/format";

/** Connect button that becomes a truncated address pill + disconnect menu. */
export default function ConnectButton() {
  const { address, connected, connecting, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!connected) {
    return (
      <button className="btn btn--primary btn--sm" onClick={() => void connect()} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect"}
      </button>
    );
  }

  return (
    <div className="addr" ref={ref}>
      <button className="addr__pill" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <span className="pricepill__dot pricepill__dot--up" />
        {truncateAddress(address, 4, 4)}
      </button>
      {open && (
        <div className="addr__menu" role="menu">
          <div className="addr__menu-row">
            <span className="faint">Connected</span>
            <span className="mono">{truncateAddress(address, 5, 4)}</span>
          </div>
          <hr className="divider" />
          <button
            className="addr__menu-btn"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
