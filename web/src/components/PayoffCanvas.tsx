import { useEffect, useRef } from "react";

interface PayoffCanvasProps {
  /** Spot BTC-USD */
  spot: number | null;
  /** Strike BTC-USD */
  strike: number | null;
  /** Premium per 1 sBTC (USD) */
  premiumPerSbtc: number | null;
}

// design tokens (mirrors global.css so canvas matches the page)
const COLORS = {
  ink: "#1B1A16",
  inkSoft: "#5C564A",
  inkFaint: "#8A8474",
  indigo: "#27314E",
  amber: "#C2762A",
  paper: "#F4EFE4",
  sold: "rgba(194,118,42,.18)",
};
const FONT_MONO = '500 11px "IBM Plex Mono", monospace';

/**
 * Hold-vs-covered-call payoff diagram.
 *   hold        = s                         (value of holding 1 BTC)
 *   coveredCall = min(s, K) + premium       (call writer's terminal value)
 * The region above K between the two lines is the "upside sold".
 * Redraws on prop change and on resize; devicePixelRatio aware.
 */
export default function PayoffCanvas({ spot, strike, premiumPerSbtc }: PayoffCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 600;
      const cssH = canvas.clientHeight || 280;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = COLORS.paper;
      ctx.fillRect(0, 0, cssW, cssH);

      // need a valid spot to draw anything meaningful
      if (!spot || spot <= 0 || !strike || strike <= 0) {
        ctx.fillStyle = COLORS.inkFaint;
        ctx.font = FONT_MONO;
        ctx.textAlign = "center";
        ctx.fillText("awaiting quote…", cssW / 2, cssH / 2);
        return;
      }

      const prem = premiumPerSbtc && premiumPerSbtc > 0 ? premiumPerSbtc : 0;

      // plot area
      const padL = 56;
      const padR = 18;
      const padT = 18;
      const padB = 30;
      const plotW = cssW - padL - padR;
      const plotH = cssH - padT - padB;

      // domains
      const xMin = spot * 0.7;
      const xMax = spot * 1.5;
      const yMin = xMin; // hold value at xMin
      const yMax = xMax + prem; // headroom for premium on covered line
      const yLo = yMin * 0.98;
      const yHi = yMax * 1.02;

      const xToPx = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * plotW;
      const yToPx = (y: number) => padT + plotH - ((y - yLo) / (yHi - yLo)) * plotH;

      // ---- axes / grid ticks ----
      ctx.strokeStyle = "rgba(27,26,22,.12)";
      ctx.lineWidth = 1;
      ctx.fillStyle = COLORS.inkFaint;
      ctx.font = FONT_MONO;

      const xTicks = 5;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i <= xTicks; i++) {
        const x = xMin + ((xMax - xMin) * i) / xTicks;
        const px = xToPx(x);
        ctx.beginPath();
        ctx.moveTo(px, padT);
        ctx.lineTo(px, padT + plotH);
        ctx.stroke();
        ctx.fillText(fmtAxisUsd(x), px, padT + plotH + 6);
      }

      const yTicks = 4;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= yTicks; i++) {
        const y = yLo + ((yHi - yLo) * i) / yTicks;
        const py = yToPx(y);
        ctx.beginPath();
        ctx.moveTo(padL, py);
        ctx.lineTo(padL + plotW, py);
        ctx.stroke();
        ctx.fillText(fmtAxisUsd(y), padL - 8, py);
      }

      // ---- "upside sold" shaded region (above K, between hold and covered) ----
      ctx.fillStyle = COLORS.sold;
      ctx.beginPath();
      ctx.moveTo(xToPx(strike), yToPx(strike + prem)); // covered at K
      ctx.lineTo(xToPx(xMax), yToPx(strike + prem)); // covered flat to xMax
      ctx.lineTo(xToPx(xMax), yToPx(xMax)); // down to hold at xMax
      ctx.lineTo(xToPx(strike), yToPx(strike)); // back along hold to K
      ctx.closePath();
      ctx.fill();

      // ---- hold line (diagonal, ink-faint dashed) ----
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = COLORS.inkFaint;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xToPx(xMin), yToPx(xMin));
      ctx.lineTo(xToPx(xMax), yToPx(xMax));
      ctx.stroke();
      ctx.restore();

      // ---- covered-call line: min(s,K)+prem (indigo, 2.5px) ----
      ctx.strokeStyle = COLORS.indigo;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(xToPx(xMin), yToPx(xMin + prem));
      ctx.lineTo(xToPx(strike), yToPx(strike + prem));
      ctx.lineTo(xToPx(xMax), yToPx(strike + prem));
      ctx.stroke();

      // ---- vertical markers at spot (ink) and strike (amber) ----
      const marker = (x: number, color: string, label: string) => {
        const px = xToPx(x);
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(px, padT);
        ctx.lineTo(px, padT + plotH);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = color;
        ctx.font = FONT_MONO;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(label, px, padT + 12);
      };
      marker(spot, COLORS.ink, "spot");
      marker(strike, COLORS.amber, "strike");

      // ---- "upside sold" label inside the shaded region ----
      const labelX = (xToPx(strike) + xToPx(xMax)) / 2;
      const labelY = (yToPx(strike + prem) + yToPx((strike + xMax) / 2)) / 2;
      ctx.fillStyle = COLORS.amber;
      ctx.font = '600 10px "Hanken Grotesk", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("UPSIDE SOLD", labelX, labelY);
    };

    draw();

    // redraw on resize (ResizeObserver where available, else window resize)
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => draw());
      ro.observe(canvas);
    }
    const onResize = () => draw();
    window.addEventListener("resize", onResize);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [spot, strike, premiumPerSbtc]);

  return <canvas ref={canvasRef} className="payoff__canvas" role="img" aria-label="Hold versus covered-call payoff" />;
}

function fmtAxisUsd(v: number): string {
  if (v >= 1000) return "$" + (v / 1000).toFixed(0) + "k";
  return "$" + v.toFixed(0);
}
