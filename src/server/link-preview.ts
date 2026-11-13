import { linkScreenshotUrl } from "@/lib/link-preview";

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export async function fetchLinkScreenshot(value: string) {
  const url = linkScreenshotUrl(value);
  if (!url) throw new Error("collections.link_preview_invalid_url");

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("collections.link_preview_fetch_failed");
  if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "image/png")
    throw new Error("collections.link_preview_invalid_image");
  if (!response.body) throw new Error("collections.link_preview_invalid_image");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SCREENSHOT_BYTES) {
        await reader.cancel();
        throw new Error("collections.link_preview_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte))
    throw new Error("collections.link_preview_invalid_image");
  return bytes;
}
