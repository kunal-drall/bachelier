// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletProvider } from "../hooks/useWallet";
import { ToastProvider } from "../components/Toasts";
import Landing from "../pages/Landing";
import AppPage from "../pages/AppPage";

// Simulate the API being completely absent: every fetch rejects.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function wrap(node: ReactNode, route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <WalletProvider>
          <ToastProvider>{node}</ToastProvider>
        </WalletProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("routes render with API absent (no crash, no console errors)", () => {
  it("Landing renders em-dash placeholders", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(wrap(<Landing />, "/"));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    // stat chips fall back to em-dash on fetch failure
    await waitFor(() => expect(screen.getAllByText("—").length).toBeGreaterThan(0));
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("AppPage renders the builder + yield + rounds without crashing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(wrap(<AppPage />, "/app"));
    expect(screen.getByText("The covered-call vault.")).toBeInTheDocument();
    expect(screen.getByText("Position builder")).toBeInTheDocument();
    expect(screen.getByText("Projected yield")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Recent rounds")).toBeInTheDocument());
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
