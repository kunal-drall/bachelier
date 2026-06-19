// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BuilderCard from "./BuilderCard";
import YieldCard from "./YieldCard";
import { reconcileQuote } from "../lib/quoteView";
import type { QuoteDto } from "@bachelier/shared/dto";

const MOCK_QUOTE: QuoteDto = {
  spot: 112_500,
  strike: 123_750,
  premiumPerSbtcUsdc: 430,
  premiumTotalUsdc: 430,
  weeklyPct: 0.00382,
  apy: 0.238,
  downsideCushionPct: 0.0382,
  breakeven: 112_070,
  capValue: 124_180,
  tYears: 7 / 365,
  r: 0.04,
  onChain: null,
};

const noop = () => {};

function renderBuilder() {
  const view = reconcileQuote(null, MOCK_QUOTE);
  return render(
    <BuilderCard
      mode="deposit"
      onModeChange={noop}
      amount="1"
      onAmountChange={noop}
      otmBps={1000}
      onOtmChange={noop}
      iv={0.55}
      onIvChange={noop}
      view={view}
      actionLabel="Deposit sBTC"
      onAction={noop}
      actionDisabled={false}
    />,
  );
}

describe("builder math display", () => {
  it("renders the premium figure as ≈ $430", () => {
    renderBuilder();
    expect(screen.getByText("≈ $430")).toBeInTheDocument();
  });

  it("renders the APY as 23.8%", () => {
    renderBuilder();
    expect(screen.getAllByText("23.8%").length).toBeGreaterThan(0);
  });

  it("renders the strike from the quote", () => {
    renderBuilder();
    expect(screen.getByText("$123,750")).toBeInTheDocument();
  });
});

describe("yield card math display", () => {
  it("shows the big APY figure and premium per sBTC", () => {
    const view = reconcileQuote(null, MOCK_QUOTE);
    render(
      <YieldCard
        view={view}
        loading={false}
        mode="deposit"
        contracts="1"
        onContractsChange={noop}
        onBuy={noop}
        buyDisabled={false}
        buyLabel="Buy calls"
      />,
    );
    expect(screen.getAllByText("23.8%").length).toBeGreaterThan(0);
    expect(screen.getByText("≈ $430")).toBeInTheDocument();
  });
});
