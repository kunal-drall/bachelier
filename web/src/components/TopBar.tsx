import { Link } from "react-router-dom";
import { NETWORK_BADGE } from "../lib/config";
import PricePill from "./PricePill";
import ConnectButton from "./ConnectButton";
import FaucetButton from "./FaucetButton";

interface TopBarProps {
  variant: "landing" | "app";
}

export default function TopBar({ variant }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="container topbar__inner">
        <div className="topbar__left">
          <Link to="/" className="wordmark">
            Bachelier<span className="accent">.</span>
          </Link>
          <span className="badge">{NETWORK_BADGE}</span>
        </div>

        <div className="topbar__right">
          {variant === "landing" ? (
            <Link to="/app" className="btn btn--primary btn--sm">
              Launch app
            </Link>
          ) : (
            <>
              <PricePill />
              <FaucetButton />
              <ConnectButton />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
