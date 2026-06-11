import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTxStatus, isTerminal } from "../hooks/useTxStatus";
import { explorerTxUrl } from "../lib/config";
import { truncateAddress } from "../lib/format";

type ToastKind = "info" | "success" | "error" | "pending";

interface BaseToast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  /** when set, the toast tracks this transaction to completion */
  txid?: string;
}

interface ToastContextValue {
  push: (t: Omit<BaseToast, "id">) => string;
  pushTx: (txid: string, title?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;
const nextId = () => `t${Date.now()}_${counter++}`;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<BaseToast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((t: Omit<BaseToast, "id">) => {
    const id = nextId();
    setToasts((ts) => [...ts, { ...t, id }]);
    // auto-dismiss non-pending, non-tx toasts
    if (t.kind !== "pending" && !t.txid) {
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000);
    }
    return id;
  }, []);

  const pushTx = useCallback(
    (txid: string, title = "Transaction submitted") => {
      const id = nextId();
      setToasts((ts) => [...ts, { id, kind: "pending", title, txid }]);
      return id;
    },
    [],
  );

  const value = useMemo<ToastContextValue>(() => ({ push, pushTx, dismiss }), [push, pushTx, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) =>
          t.txid ? (
            <TxToast key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ) : (
            <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ),
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used within ToastProvider");
  return ctx;
}

// --- presentational ---------------------------------------------------------

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === "pending") return <div className="spinner" aria-label="pending" />;
  if (kind === "success") return <div className="dot-ok" aria-label="success" />;
  if (kind === "error") return <div className="dot-err" aria-label="error" />;
  return <div className="pricepill__dot" aria-hidden />;
}

function ToastView({ toast, onDismiss }: { toast: BaseToast; onDismiss: () => void }) {
  return (
    <div className={`toast toast--${toast.kind}`} role="status">
      <div className="toast__icon">
        <ToastIcon kind={toast.kind} />
      </div>
      <div className="toast__body">
        <div className="toast__title">{toast.title}</div>
        {toast.message && <div className="toast__msg">{toast.message}</div>}
      </div>
      <button className="toast__close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

/**
 * A toast bound to a transaction: polls status, flips kind to success/error on
 * a terminal result, and invalidates vault/positions caches on success.
 */
function TxToast({ toast, onDismiss }: { toast: BaseToast; onDismiss: () => void }) {
  const qc = useQueryClient();
  const { data } = useTxStatus(toast.txid ?? null);

  const status = data?.status;
  const terminal = isTerminal(status);

  // derive presentation from the live status
  let kind: ToastKind = "pending";
  let title = toast.title;
  let message: ReactNode = undefined;

  if (status === "success") {
    kind = "success";
    title = "Transaction confirmed";
  } else if (status === "abort_by_post_condition") {
    kind = "error";
    title = "Transaction failed";
    message = "Post-condition not met — no funds moved.";
  } else if (status === "abort_by_response") {
    kind = "error";
    title = "Transaction failed";
    message = "Contract returned an error.";
  } else {
    message = "Waiting for confirmation…";
  }

  // invalidate caches exactly once, the first time we reach success
  const invalidated = useRef(false);
  useEffect(() => {
    if (status === "success" && !invalidated.current) {
      invalidated.current = true;
      qc.invalidateQueries({ queryKey: ["vault"] });
      qc.invalidateQueries({ queryKey: ["positions"] });
      qc.invalidateQueries({ queryKey: ["rounds"] });
    }
  }, [status, qc]);

  return (
    <div className={`toast toast--${kind}`} role="status">
      <div className="toast__icon">
        <ToastIcon kind={kind} />
      </div>
      <div className="toast__body">
        <div className="toast__title">{title}</div>
        <div className="toast__msg">
          {message}
          {toast.txid && (
            <>
              {" "}
              <a className="toast__link" href={explorerTxUrl(toast.txid)} target="_blank" rel="noreferrer">
                {truncateAddress(toast.txid, 6, 4)}
              </a>
            </>
          )}
        </div>
      </div>
      {terminal && (
        <button className="toast__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
