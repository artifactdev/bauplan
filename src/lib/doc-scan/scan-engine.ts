import type { DocumentDetection, ProcessOptions, Raster } from "./cv-ops";
import type { Quad } from "./geometry";

export type ScanRequest =
  | { id: number; type: "init" }
  | { id: number; type: "detect"; image: Raster }
  | { id: number; type: "process"; image: Raster; options: ProcessOptions };

export type ScanResponse =
  | { id: number; ok: true; type: "init" }
  | { id: number; ok: true; type: "detect"; detection: DocumentDetection | null }
  | { id: number; ok: true; type: "process"; image: Raster }
  | { id: number; ok: false; error: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (r: ScanResponse) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(error: Error) {
  for (const p of pending.values()) p.reject(error);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (event: MessageEvent<ScanResponse>) => {
    const p = pending.get(event.data.id);
    if (!p) return;
    pending.delete(event.data.id);
    if (event.data.ok) p.resolve(event.data);
    else p.reject(new Error(event.data.error));
  };
  w.onerror = (event) => {
    event.preventDefault();
    failAll(new Error(event.message || "Scanner worker failed"));
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

function call(
  request: DistributiveOmit<ScanRequest, "id">,
  transfer: Transferable[] = [],
): Promise<ScanResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ ...request, id }, transfer);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Starts loading OpenCV in the background; resolves once it is usable. */
export async function warmUpScanner(): Promise<void> {
  await call({ type: "init" });
}

export async function detectQuad(image: Raster): Promise<Quad | null> {
  const r = await call({ type: "detect", image });
  if (!r.ok || r.type !== "detect") throw new Error("Unexpected scanner response");
  return r.detection?.quad ?? null;
}

/** Live rasters are disposable; ownership moves to the worker instead of copying pixels. */
export async function detectLiveFrame(image: Raster): Promise<DocumentDetection | null> {
  const r = await call({ type: "detect", image }, [image.data.buffer]);
  if (!r.ok || r.type !== "detect") throw new Error("Unexpected scanner response");
  return r.detection;
}

export async function processScan(image: Raster, options: ProcessOptions): Promise<Raster> {
  const r = await call({ type: "process", image, options });
  if (!r.ok || r.type !== "process") throw new Error("Unexpected scanner response");
  return r.image;
}

/** Frees the worker and its WASM memory (OpenCV is reloaded from cache next time). */
export function disposeScanner() {
  failAll(new Error("Scanner closed"));
  worker?.terminate();
  worker = null;
}
