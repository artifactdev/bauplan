import type { Raster } from "./cv-ops";
import { fitScale } from "./geometry";

function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D not available");
  return { canvas, ctx };
}

function drawToRaster(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSide: number,
  maxPixels: number,
): Raster {
  const scale = fitScale(width, height, maxSide, maxPixels);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const { ctx } = canvas2d(w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Decodes an image file (respecting EXIF orientation) and downscales it to maxSide / maxPixels. */
export async function decodeImage(blob: Blob, maxSide: number, maxPixels = Infinity): Promise<Raster> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    return drawToRaster(bitmap, bitmap.width, bitmap.height, maxSide, maxPixels);
  } finally {
    bitmap.close();
  }
}

export function grabVideoFrame(video: HTMLVideoElement, maxSide: number, maxPixels = Infinity): Raster | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  return drawToRaster(video, video.videoWidth, video.videoHeight, maxSide, maxPixels);
}

export async function encodeJpeg(image: Raster, quality = 0.85): Promise<Blob> {
  const { canvas, ctx } = canvas2d(image.width, image.height);
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("JPEG encoding failed");
  return blob;
}
