export const SHARE_CACHE = "bauplan-share-inbox-v1";
const MAX_AGE = 86400000;

export type SharedFile = { key: string; file: File };

export async function listSharedFiles(): Promise<SharedFile[]> {
  if (!("caches" in globalThis)) return [];
  const cache = await caches.open(SHARE_CACHE);
  const files: SharedFile[] = [];
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!response) continue;
    if (Number(response.headers.get("x-shared-at")) < Date.now() - MAX_AGE) {
      await cache.delete(request);
      continue;
    }
    files.push({
      key: request.url,
      file: new File(
        [await response.blob()],
        decodeURIComponent(response.headers.get("x-file-name") ?? ""),
        { type: response.headers.get("content-type") ?? "" },
      ),
    });
  }
  return files;
}

export async function removeSharedFile(key: string) {
  const cache = await caches.open(SHARE_CACHE);
  await cache.delete(key);
}
