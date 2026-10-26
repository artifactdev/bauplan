import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const publicDirectory = ".output/public";
const serverEntry = ".output/server/index.mjs";
const source = await readFile(serverEntry, "utf8");
const dataMarker = "var public_assets_data_default = ";
const markerIndex = source.indexOf(dataMarker);
const objectStart = source.indexOf("{", markerIndex + dataMarker.length);
const objectEndMarker = "\n};\n//#endregion";
const objectEndMarkerIndex = source.indexOf(objectEndMarker, objectStart);

if (markerIndex < 0 || objectStart < 0 || objectEndMarkerIndex < 0) {
  throw new Error(`Could not find Nitro public asset metadata in ${serverEntry}`);
}

const objectEnd = objectEndMarkerIndex + 2;
const assets = JSON.parse(source.slice(objectStart, objectEnd));

for (const name of await readdir(publicDirectory)) {
  if (!/^(?:sw\.js|manifest\.webmanifest|workbox-[\w-]+\.js)$/.test(name)) continue;

  const filePath = join(publicDirectory, name);
  const [content, fileStats] = await Promise.all([readFile(filePath), stat(filePath)]);
  const type = name.endsWith(".webmanifest")
    ? "application/manifest+json"
    : "text/javascript; charset=utf-8";

  assets[`/${name}`] = {
    type,
    etag: `"${content.length.toString(16)}-${createHash("md5").update(content).digest("base64").replace(/=+$/, "")}"`,
    mtime: fileStats.mtime.toISOString(),
    size: content.length,
    path: `../public/${name}`,
  };
}

await writeFile(
  serverEntry,
  `${source.slice(0, objectStart)}${JSON.stringify(assets, null, "\t")}${source.slice(objectEnd)}`,
);
