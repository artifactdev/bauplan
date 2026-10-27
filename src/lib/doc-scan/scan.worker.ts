/// <reference lib="webworker" />
import cvModule from "@techstark/opencv-js";
import { detectDocumentDetails, processDocument, resolveCv, type Raster } from "./cv-ops";
import type { ScanRequest, ScanResponse } from "./scan-engine";

// OpenCV (≈ 10 MB incl. WASM) is only loaded inside this worker, i.e. once the scanner opens.
const ready = resolveCv(cvModule);
const scope = self as unknown as DedicatedWorkerGlobalScope;

function reply(message: ScanResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

scope.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const request = event.data;
  try {
    const cv = await ready;
    if (request.type === "init") return reply({ id: request.id, ok: true, type: "init" });
    if (request.type === "detect")
      return reply({
        id: request.id,
        ok: true,
        type: "detect",
        detection: detectDocumentDetails(cv, request.image),
      });
    const image: Raster = processDocument(cv, request.image, request.options);
    reply({ id: request.id, ok: true, type: "process", image }, [image.data.buffer]);
  } catch (error) {
    reply({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
