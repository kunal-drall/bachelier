import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement the 2D canvas context. Default it to null so any
// component that renders a <canvas> degrades quietly (our PayoffCanvas guards
// on a null context). Individual tests may override this with a recording stub.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null;
  } as unknown as HTMLCanvasElement["getContext"];
}
