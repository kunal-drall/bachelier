// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import PayoffCanvas from "./PayoffCanvas";

/**
 * jsdom has no real 2D canvas context. We install a recording stub on
 * HTMLCanvasElement.prototype.getContext and assert the component drove it
 * (moved the pen, stroked lines, drew text) without crashing.
 */
function makeRecordingContext() {
  const calls: string[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(name);
      void args;
      return undefined;
    };
  const ctx = {
    calls,
    canvas: null as unknown,
    // state we mutate freely
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    // recorded methods
    setTransform: rec("setTransform"),
    clearRect: rec("clearRect"),
    fillRect: rec("fillRect"),
    beginPath: rec("beginPath"),
    closePath: rec("closePath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    stroke: rec("stroke"),
    fill: rec("fill"),
    fillText: rec("fillText"),
    setLineDash: rec("setLineDash"),
    save: rec("save"),
    restore: rec("restore"),
  };
  return ctx;
}

let recording: ReturnType<typeof makeRecordingContext>;
// the spy handle — typed loosely because getContext is heavily overloaded
let getContextSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

beforeEach(() => {
  recording = makeRecordingContext();
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(function (this: HTMLCanvasElement): never {
      recording.canvas = this;
      return recording as never;
    }) as unknown as typeof getContextSpy;
});

afterEach(() => {
  getContextSpy.mockRestore();
});

describe("PayoffCanvas", () => {
  it("renders and draws given spot/strike/premium without crashing", () => {
    const { container } = render(<PayoffCanvas spot={112_500} strike={123_750} premiumPerSbtc={430} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(getContextSpy).toHaveBeenCalledWith("2d");
    // it drew the payoff lines + axis text
    expect(recording.calls).toContain("moveTo");
    expect(recording.calls).toContain("lineTo");
    expect(recording.calls).toContain("stroke");
    expect(recording.calls).toContain("fillText");
  });

  it("renders a placeholder when spot is missing (no crash)", () => {
    const { container } = render(<PayoffCanvas spot={null} strike={null} premiumPerSbtc={null} />);
    expect(container.querySelector("canvas")).not.toBeNull();
    // still drew the 'awaiting quote' text
    expect(recording.calls).toContain("fillText");
  });
});
