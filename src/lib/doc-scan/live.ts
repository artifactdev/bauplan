import type { DocumentDetection } from "./cv-ops";
import { quadArea, type Quad } from "./geometry";
import { createVideoReader } from "./image";
import { detectLiveFrame } from "./scan-engine";

export type LiveOutline = { quad: Quad; width: number; height: number; stable: boolean };
export type ScanTiming = {
  readMs: number;
  detectMs: number;
  ageMs: number;
  frameGap: number | null;
  side: number;
};
const timings: ScanTiming[] = [];

/** Bounded, image-free diagnostics; populated only in development. */
export function readScanTimings(): readonly ScanTiming[] {
  return timings.slice();
}

/** Normalized geometry makes tracking independent of analysis resolution. */
export function createDocumentTracker() {
  let outline: Quad | null = null;
  let anchor: Quad | null = null;
  let candidate: Quad | null = null;
  let candidateCount = 0;
  let count = 0;
  let since = 0;
  let last = -Infinity;
  const distance = (a: Quad, b: Quad) =>
    Math.max(...a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y)));
  const reset = () => {
    outline = anchor = candidate = null;
    candidateCount = count = 0;
    since = 0;
    last = -Infinity;
  };
  return {
    reset,
    update(detection: DocumentDetection | null, width: number, height: number, now: number) {
      if (now - last > 650) reset();
      const quad = detection?.quad.map((p) => ({ x: p.x / width, y: p.y / height })) as
        Quad | undefined;
      if (!quad || !detection || detection.score < 0.55) {
        count = 0;
        anchor = null;
        candidate = null;
        candidateCount = 0;
        return outline ? { quad: outline, stable: false } : null;
      }
      if (outline && distance(outline, quad) > 0.08) {
        candidateCount = candidate && distance(candidate, quad) < 0.025 ? candidateCount + 1 : 1;
        candidate = quad;
        count = 0;
        anchor = null;
        if (candidateCount < 2) return { quad: outline, stable: false };
        outline = null;
      }
      candidate = null;
      candidateCount = 0;
      const steady = anchor && distance(anchor, quad) < 0.018 && now - last < 650;
      if (!steady) {
        anchor = quad;
        since = now;
        count = 0;
      }
      count++;
      last = now;
      outline = outline
        ? (outline.map((p, i) => ({
            x: p.x * 0.6 + quad[i]!.x * 0.4,
            y: p.y * 0.6 + quad[i]!.y * 0.4,
          })) as Quad)
        : quad;
      const suitable =
        detection.complete &&
        detection.score >= 0.7 &&
        detection.sharpness >= 40 &&
        quadArea(quad) >= 0.2;
      if (!suitable) {
        count = 0;
        since = now;
      }
      return { quad: outline, stable: suitable && count >= 5 && now - since >= 1200 };
    },
  };
}

/** Paced fresh-frame analysis with a single outstanding readback/detection. */
export function startLiveScanner(
  video: HTMLVideoElement,
  callbacks: {
    onOutline: (outline: LiveOutline | null) => void;
    onError: (error: unknown) => void;
    onTiming?: (timing: ScanTiming) => void;
  },
) {
  const reader = createVideoReader();
  const tracker = createDocumentTracker();
  let stopped = false;
  let running = false;
  let generation = 0;
  let timer: number | undefined;
  let videoCallback: number | undefined;
  let expiry: number | undefined;
  let previousTime = -1;
  let previousDimensions = "";
  let previousPresented: number | undefined;
  let side = 640;
  let interval = 250;
  let suspended = false;
  const cancel = () => {
    window.clearTimeout(timer);
    if (videoCallback !== undefined) video.cancelVideoFrameCallback?.(videoCallback);
    videoCallback = undefined;
  };
  const reset = () => {
    window.clearTimeout(expiry);
    generation++;
    tracker.reset();
    previousTime = -1;
    previousPresented = undefined;
    callbacks.onOutline(null);
  };
  const schedule = () => {
    if (stopped || running || document.hidden || suspended) return;
    timer = window.setTimeout(() => {
      if (typeof video.requestVideoFrameCallback === "function") {
        videoCallback = video.requestVideoFrameCallback((_now, metadata) => {
          videoCallback = undefined;
          void analyze(metadata.presentedFrames);
        });
      } else {
        void analyze();
      }
    }, interval);
  };
  const analyze = async (presented?: number) => {
    if (stopped || running || document.hidden || suspended) return;
    if (video.currentTime === previousTime) {
      schedule();
      return;
    }
    const dimensions = `${video.videoWidth}x${video.videoHeight}`;
    if (dimensions !== previousDimensions) {
      reset();
      previousDimensions = dimensions;
    }
    previousTime = video.currentTime;
    running = true;
    const version = generation;
    const started = performance.now();
    try {
      const frame = reader.read(video, side);
      const readMs = performance.now() - started;
      if (!frame) return;
      const { width, height } = frame;
      const detectionStarted = performance.now();
      const detection = await detectLiveFrame(frame);
      if (stopped || version !== generation || document.hidden || suspended) return;
      if (`${video.videoWidth}x${video.videoHeight}` !== dimensions) {
        reset();
        return;
      }
      const now = performance.now();
      const detectMs = now - detectionStarted;
      const ageMs = now - started;
      const timing = {
        readMs,
        detectMs,
        ageMs,
        side,
        frameGap:
          presented === undefined || previousPresented === undefined
            ? null
            : presented - previousPresented,
      };
      previousPresented = presented;
      if (import.meta.env.DEV) {
        timings.push(timing);
        if (timings.length > 120) timings.shift();
      }
      callbacks.onTiming?.(timing);
      if (ageMs > 500) {
        tracker.reset();
        callbacks.onOutline(null);
      } else {
        const tracked = tracker.update(detection, width, height, now);
        window.clearTimeout(expiry);
        if (tracked)
          expiry = window.setTimeout(() => {
            tracker.reset();
            callbacks.onOutline(null);
          }, 650);
        callbacks.onOutline(
          tracked
            ? {
                quad: tracked.quad.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad,
                width,
                height,
                stable: tracked.stable,
              }
            : null,
        );
      }
      // Reduce only live analysis work on a struggling device, never still resolution.
      if (readMs > 12 || detectMs > 120) side = 480;
      else if (readMs < 6 && detectMs < 60) side = 640;
      interval = Math.max(250, Math.min(400, detectMs * 2));
    } catch (error) {
      if (!stopped && version === generation) {
        stopped = true;
        window.clearTimeout(expiry);
        tracker.reset();
        callbacks.onOutline(null);
        callbacks.onError(error);
      }
    } finally {
      running = false;
      schedule();
    }
  };
  const visibility = () => {
    cancel();
    reset();
    schedule();
  };
  const pageHide = () => {
    suspended = true;
    cancel();
    reset();
  };
  const pageShow = () => {
    suspended = false;
    visibility();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pageHide);
  window.addEventListener("pageshow", pageShow);
  schedule();
  return () => {
    stopped = true;
    cancel();
    window.clearTimeout(expiry);
    tracker.reset();
    reader.dispose();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pageHide);
    window.removeEventListener("pageshow", pageShow);
  };
}
