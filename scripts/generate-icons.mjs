// Regenerates the raster app icons from public/app-icon.svg and scripts/icons/app-icon-maskable.svg
// (full-bleed variant with the artwork inside the 80% safe zone for maskable and Apple icons).
// Run with: node scripts/generate-icons.mjs
import { readFile, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = new URL("../public/", import.meta.url);
const icon = new URL("app-icon.svg", root);
const maskable = new URL("icons/app-icon-maskable.svg", import.meta.url);

async function png(source, size) {
  const image = await loadImage(await readFile(source));
  const canvas = createCanvas(size, size);
  canvas.getContext("2d").drawImage(image, 0, 0, size, size);
  return canvas.toBuffer("image/png");
}

// ICO container with embedded PNG images (supported by all current browsers).
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

const outputs = [
  ["app-icon-192.png", icon, 192],
  ["app-icon-512.png", icon, 512],
  ["app-icon-maskable-512.png", maskable, 512],
  ["apple-touch-icon.png", maskable, 180],
];
for (const [name, source, size] of outputs)
  await writeFile(new URL(name, root), await png(source, size));

const favicon = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, data: await png(icon, size) })),
);
await writeFile(new URL("favicon.ico", root), ico(favicon));
