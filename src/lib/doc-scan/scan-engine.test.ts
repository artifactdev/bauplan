import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectLiveFrame, detectQuad, disposeScanner, processScan } from "./scan-engine";
import type { ScanRequest, ScanResponse } from "./scan-engine";
import { fullQuad } from "./geometry";

const posts = vi.fn();
const terminate = vi.fn();
class TestWorker {
  onmessage?: (event: { data: ScanResponse }) => void;
  onerror?: (event: { preventDefault: () => void; message: string }) => void;
  terminate = terminate;
  postMessage(request: ScanRequest, transfer: Transferable[]) {
    posts(request, transfer);
    structuredClone(request, { transfer });
    queueMicrotask(() =>
      this.onmessage?.({
        data:
          request.type === "detect"
            ? { id: request.id, ok: true, type: "detect", detection: null }
            : request.type === "process"
              ? { id: request.id, ok: true, type: "process", image: request.image }
              : { id: request.id, ok: true, type: "init" },
      }),
    );
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => {
  disposeScanner();
  vi.unstubAllGlobals();
});

describe("scanner worker ownership", () => {
  it("transfers disposable live rasters instead of cloning their buffer", async () => {
    const image = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    await detectLiveFrame(image);
    expect(posts.mock.calls[0]![1]).toHaveLength(1);
    expect(image.data.byteLength).toBe(0);
  });
  it("preserves still pixels through both detection and processing", async () => {
    const image = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    await detectQuad(image);
    await processScan(image, { quad: fullQuad(2, 2), rotation: 0, filter: "color" });
    expect(image.data.byteLength).toBe(16);
    expect(posts.mock.calls.map((call) => call[1])).toEqual([[], []]);
  });
  it("rejects outstanding requests on disposal", async () => {
    vi.stubGlobal(
      "Worker",
      class extends TestWorker {
        override postMessage() {}
      },
    );
    const result = detectLiveFrame({ width: 2, height: 2, data: new Uint8ClampedArray(16) });
    disposeScanner();
    await expect(result).rejects.toThrow("Scanner closed");
    expect(terminate).toHaveBeenCalledOnce();
  });
  it("surfaces synchronous worker creation failures", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked");
        }
      },
    );
    await expect(
      detectQuad({ width: 2, height: 2, data: new Uint8ClampedArray(16) }),
    ).rejects.toThrow("blocked");
  });
});
