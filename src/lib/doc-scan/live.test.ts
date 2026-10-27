import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDetection, Raster } from "./cv-ops";
import { createDocumentTracker, startLiveScanner } from "./live";
import { createVideoReader } from "./image";
import { detectLiveFrame } from "./scan-engine";

vi.mock("./image", () => ({ createVideoReader: vi.fn() }));
vi.mock("./scan-engine", () => ({ detectLiveFrame: vi.fn() }));

const detection = (offset = 0): DocumentDetection => ({
  quad: [
    { x: 100 + offset, y: 80 },
    { x: 540 + offset, y: 80 },
    { x: 540 + offset, y: 400 },
    { x: 100 + offset, y: 400 },
  ],
  score: 0.9,
  sharpness: 150,
  complete: true,
});

describe("normalized document tracking", () => {
  it("smooths stationary jitter and confirms only an elapsed, multi-frame hold", () => {
    const tracker = createDocumentTracker();
    const positions: number[] = [];
    for (let i = 0; i < 10; i++) {
      const tracked = tracker.update(detection(i % 2 ? 3 : -3), 640, 480, i * 180)!;
      positions.push(tracked.quad[0].x * 640);
      expect(tracked.stable).toBe(i >= 7);
    }
    expect(Math.max(...positions.slice(3)) - Math.min(...positions.slice(3))).toBeLessThan(3);
  });

  it("normalizes resolution changes instead of treating them as movement", () => {
    const tracker = createDocumentTracker();
    tracker.update(detection(), 640, 480, 0);
    const half = {
      ...detection(),
      quad: detection().quad.map((p) => ({ x: p.x / 2, y: p.y / 2 })) as DocumentDetection["quad"],
    };
    expect(tracker.update(half, 320, 240, 180)?.quad[0].x).toBeCloseTo(100 / 640);
  });

  it("requires confirmation before switching to a distant candidate", () => {
    const tracker = createDocumentTracker();
    tracker.update(detection(), 640, 480, 0);
    const jump = tracker.update(detection(-90), 640, 480, 180)!;
    expect(jump.quad[0].x).toBeCloseTo(100 / 640);
    expect(jump.stable).toBe(false);
    expect(tracker.update(detection(-90), 640, 480, 360)?.quad[0].x).toBeCloseTo(10 / 640);
  });

  it("rejects slow accumulated drift even when adjacent frames are close", () => {
    const tracker = createDocumentTracker();
    for (let i = 0; i < 10; i++)
      expect(tracker.update(detection(i * 5), 640, 480, i * 180)?.stable).toBe(false);
  });

  it.each([{ complete: false }, { score: 0.6 }, { sharpness: 10 }])(
    "never captures a weak, clipped or blurred candidate: %j",
    (quality) => {
      const tracker = createDocumentTracker();
      for (let i = 0; i < 10; i++)
        expect(tracker.update({ ...detection(), ...quality }, 640, 480, i * 180)?.stable).toBe(
          false,
        );
    },
  );

  it("never captures small shapes", () => {
    const tracker = createDocumentTracker();
    const small = {
      ...detection(),
      quad: detection().quad.map((p) => ({
        x: p.x * 0.4,
        y: p.y * 0.4,
      })) as DocumentDetection["quad"],
    };
    for (let i = 0; i < 10; i++)
      expect(tracker.update(small, 640, 480, i * 180)?.stable).toBe(false);
  });

  it("expires a missing outline and resets capture eligibility after document loss", () => {
    const tracker = createDocumentTracker();
    for (let i = 0; i < 8; i++) tracker.update(detection(), 640, 480, i * 180);
    expect(tracker.update(null, 640, 480, 1400)?.stable).toBe(false);
    expect(tracker.update(detection(), 640, 480, 1500)?.stable).toBe(false);
    expect(tracker.update(null, 640, 480, 2200)).toBeNull();
    expect(tracker.update(detection(), 640, 480, 2400)?.stable).toBe(false);
  });
});

describe("live analysis scheduling", () => {
  let time: number;
  let hidden: boolean;
  let read: ReturnType<typeof vi.fn<(video: HTMLVideoElement, side: number) => Raster | null>>;
  let dispose: ReturnType<typeof vi.fn<() => void>>;
  let stop: (() => void) | undefined;
  let video: HTMLVideoElement;
  const callbacks = { onOutline: vi.fn(), onError: vi.fn(), onTiming: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    time = 0;
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    video = {
      get currentTime() {
        return time;
      },
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    read = vi.fn((): Raster => ({ width: 640, height: 480, data: new Uint8ClampedArray(16) }));
    dispose = vi.fn();
    vi.mocked(createVideoReader).mockReturnValue({ read, dispose });
    vi.mocked(detectLiveFrame).mockResolvedValue(detection());
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("paces fresh frames, reuses the reader and releases it on close", async () => {
    stop = startLiveScanner(video, callbacks);
    await vi.advanceTimersByTimeAsync(250);
    expect(detectLiveFrame).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(detectLiveFrame).toHaveBeenCalledTimes(1);
    time = 1;
    await vi.advanceTimersByTimeAsync(250);
    expect(detectLiveFrame).toHaveBeenCalledTimes(2);
    expect(createVideoReader).toHaveBeenCalledTimes(1);
    stop();
    expect(dispose).toHaveBeenCalledOnce();
    time = 2;
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(2);
    stop = undefined;
  });

  it("never queues another read while detection is pending and ignores late close responses", async () => {
    let resolve!: (value: DocumentDetection) => void;
    vi.mocked(detectLiveFrame).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    stop = startLiveScanner(video, callbacks);
    await vi.advanceTimersByTimeAsync(250);
    time = 1;
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledOnce();
    stop();
    stop = undefined;
    resolve(detection());
    await vi.advanceTimersByTimeAsync(500);
    expect(callbacks.onOutline).not.toHaveBeenCalledWith(expect.objectContaining({ stable: true }));
    expect(callbacks.onTiming).not.toHaveBeenCalled();
  });

  it("resets on backgrounding and resumes only with fresh observations", async () => {
    stop = startLiveScanner(video, callbacks);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledOnce();
    expect(callbacks.onOutline).toHaveBeenCalledWith(null);
  });

  it("uses video-frame callbacks when available and cancels them on close", async () => {
    let callback: VideoFrameRequestCallback | undefined;
    video.requestVideoFrameCallback = vi.fn((fn) => {
      callback = fn;
      return 42;
    });
    video.cancelVideoFrameCallback = vi.fn();
    stop = startLiveScanner(video, callbacks);
    await vi.advanceTimersByTimeAsync(250);
    expect(read).not.toHaveBeenCalled();
    callback?.(0, { presentedFrames: 1 } as VideoFrameCallbackMetadata);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledOnce();
    time = 1;
    await vi.advanceTimersByTimeAsync(250);
    stop();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(42);
    stop = undefined;
  });

  it("adapts slow analysis without changing still-capture constraints", async () => {
    vi.mocked(detectLiveFrame).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return detection();
    });
    stop = startLiveScanner(video, callbacks);
    await vi.advanceTimersByTimeAsync(450);
    time = 1;
    await vi.advanceTimersByTimeAsync(400);
    expect(read).toHaveBeenLastCalledWith(video, 480);
    expect(callbacks.onTiming).toHaveBeenCalledWith(
      expect.objectContaining({ detectMs: 200, side: 640 }),
    );
  });

  it("reports worker errors and stops rather than retrying silently", async () => {
    vi.mocked(detectLiveFrame).mockRejectedValue(new Error("worker failed"));
    stop = startLiveScanner(video, callbacks);
    await vi.advanceTimersByTimeAsync(250);
    expect(callbacks.onError).toHaveBeenCalledOnce();
    time = 1;
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledOnce();
  });

  it("expires the outline when the camera stops delivering fresh frames", async () => {
    stop = startLiveScanner(video, callbacks);
    await vi.advanceTimersByTimeAsync(250);
    expect(callbacks.onOutline).toHaveBeenLastCalledWith(
      expect.objectContaining({ stable: false }),
    );
    await vi.advanceTimersByTimeAsync(650);
    expect(callbacks.onOutline).toHaveBeenLastCalledWith(null);
    expect(detectLiveFrame).toHaveBeenCalledOnce();
  });

  it("discards slow detections rather than capturing from an old observation", async () => {
    vi.mocked(detectLiveFrame).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return detection();
    });
    stop = startLiveScanner(video, callbacks);
    await vi.advanceTimersByTimeAsync(850);
    expect(callbacks.onOutline).toHaveBeenLastCalledWith(null);
    expect(callbacks.onTiming).toHaveBeenCalledWith(expect.objectContaining({ ageMs: 600 }));
  });

  it("discards a detection if camera dimensions change during processing", async () => {
    let resolve!: (value: DocumentDetection) => void;
    vi.mocked(detectLiveFrame).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    stop = startLiveScanner(video, callbacks);
    await vi.advanceTimersByTimeAsync(250);
    Object.defineProperty(video, "videoWidth", { value: 1080 });
    resolve(detection());
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onOutline).toHaveBeenLastCalledWith(null);
    expect(callbacks.onTiming).not.toHaveBeenCalled();
  });

  it("suspends on pagehide even if document.hidden has not changed yet", async () => {
    stop = startLiveScanner(video, callbacks);
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledOnce();
  });
});
