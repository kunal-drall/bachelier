import { Link } from "react-router-dom";
import TopBar from "../components/TopBar";
import { useVault } from "../hooks/useVault";
import { usePrice } from "../hooks/usePrice";
import { formatSats, formatPct, formatUsd, EM_DASH } from "../lib/format";

const STEPS = [
  {
    num: "01",
    title: "Deposit sBTC",
    body: "Supply sBTC to the vault and receive bcSHARE, your claim on the pool. Your Bitcoin keeps its spot exposure between the strike and the floor.",
  },
  {
    num: "02",
    title: "The pool writes weekly calls",
    body: "Each week the vault sells out-of-the-money covered calls against its sBTC, with strike and premium set by an on-chain Black–Scholes engine.",
  },
  {
    num: "03",
    title: "Premium accrues in USDC",
    body: "Buyers pay premium in USDC; it accrues to your share and is claimable any time. If the calls expire worthless, the pool keeps every cent.",
  },
];

export default function Landing() {
  const { data: vault } = useVault();
  const { data: price } = usePrice();

  const apy = vault?.forwardApy ?? vault?.trailingApy ?? null;
  const btc = price?.btcUsd ?? vault?.btcUsd ?? null;

  return (
    <>
      <TopBar variant="landing" />

      <main>
        <section className="container hero">
          <div className="overline hero__eyebrow">A covered-call vault on sBTC · Stacks</div>
          <h1 className="hero__title">
            Yield, <span className="display--em">priced</span> like it&rsquo;s 1900.
          </h1>
          <p className="hero__sub">
            Deposit sBTC. The pool writes weekly out-of-the-money covered calls, priced by an on-chain Black–Scholes
            engine, and pays you the premium in USDC. A century-old formula, settled on Bitcoin.
          </p>
          <div className="hero__cta">
            <Link to="/app" className="btn btn--primary">
              Launch app
            </Link>
            <a className="btn btn--secondary" href="#how">
              How it works
            </a>
          </div>

          <div className="statchips">
            <div className="statchip">
              <div className="statchip__label overline">Total value locked</div>
              <div className="statchip__value">{vault ? formatSats(vault.tvlSbtc) : EM_DASH}</div>
              <div className="statchip__sub">sBTC</div>
            </div>
            <div className="statchip">
              <div className="statchip__label overline">Current APY</div>
              <div className="statchip__value">{formatPct(apy)}</div>
              <div className="statchip__sub">{vault?.forwardApy != null ? "forward, from quote" : "trailing realized"}</div>
            </div>
            <div className="statchip">
              <div className="statchip__label overline">BTC price</div>
              <div className="statchip__value">{btc != null ? formatUsd(btc) : EM_DASH}</div>
              <div className="statchip__sub">USD</div>
            </div>
          </div>
        </section>

        <section id="how" className="container section">
          <div className="section__head">
            <div className="overline">The mechanism</div>
            <h2 className="section__title">Three steps, one weekly cycle.</h2>
          </div>
          <div className="howit">
            {STEPS.map((s) => (
              <article className="howcard" key={s.num}>
                <div className="howcard__num">{s.num}</div>
                <h3 className="howcard__title">{s.title}</h3>
                <p className="howcard__body">{s.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="container section" style={{ paddingTop: 0 }}>
          <div className="risk">
            <div className="risk__title overline">On risk</div>
            <p className="risk__body">
              Covered calls cap upside above the strike: in a sharp rally the pool forgoes gains beyond the strike in
              exchange for premium collected up front. Premium cushions but does not eliminate downside — if BTC falls,
              the deposited sBTC falls with it, less the premium earned. Settlement is cash-and-collateral on-chain;
              smart-contract and oracle risk apply. This is experimental software on a test network. Nothing here is
              financial advice.
            </p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer__inner">
          <span>Bachelier — peer-to-pool covered-call options on sBTC. On-chain fixed-point Black–Scholes pricing.</span>
          <span className="mono">© 1900 · 2026</span>
        </div>
      </footer>
    </>
  );
}
