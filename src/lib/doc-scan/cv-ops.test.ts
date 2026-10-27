// @vitest-environment node
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { detectDocument, processDocument, resolveCv, type Cv, type Raster } from "./cv-ops";
import { fullQuad, type Point, type Quad } from "./geometry";

let cv: Cv;
beforeAll(async () => {
  // The package exports a Promise from CommonJS; an ESM namespace import would wrap it.
  cv = await resolveCv(createRequire(import.meta.url)("@techstark/opencv-js"));
}, 30_000);

function insidePolygon(x: number, y: number, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Deterministic pseudo-random noise so the test images are stable. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** A light "sheet of paper" with text-like lines on a darker, noisy desk. */
function photo(width: number, height: number, doc: Quad | null, seed = 1): Raster {
  const rnd = noise(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const onDoc = doc && insidePolygon(x, y, doc);
      const textLine = onDoc && y % 24 < 3 && x % 90 > 15;
      const base = onDoc ? (textLine ? 40 : 232) : 70 + ((x >> 4) % 2) * 8;
      const v = base + (rnd() - 0.5) * 16;
      data[i] = v + (onDoc ? 0 : 20);
      data[i + 1] = v + (onDoc ? 0 : 8);
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function expectNear(actual: Quad, expected: Quad, tolerance: number) {
  actual.forEach((p, i) => {
    expect(Math.abs(p.x - expected[i]!.x)).toBeLessThan(tolerance);
    expect(Math.abs(p.y - expected[i]!.y)).toBeLessThan(tolerance);
  });
}

describe("detectDocument", () => {
  it("finds the four corners of a skewed document", () => {
    const doc: Quad = [
      { x: 150, y: 90 },
      { x: 620, y: 60 },
      { x: 690, y: 520 },
      { x: 110, y: 540 },
    ];
    const found = detectDocument(cv, photo(800, 600, doc));
    expect(found).not.toBeNull();
    expectNear(found!, doc, 12);
  });

  it("scales corners back to the original resolution for large photos", () => {
    const doc: Quad = [
      { x: 400, y: 300 },
      { x: 1500, y: 260 },
      { x: 1560, y: 1750 },
      { x: 360, y: 1700 },
    ];
    const found = detectDocument(cv, photo(1800, 2000, doc, 7));
    expect(found).not.toBeNull();
    expectNear(found!, doc, 25);
  });

  it("returns null when there is no document in the picture", () => {
    expect(detectDocument(cv, photo(640, 480, null, 3))).toBeNull();
  });

  it("ignores shapes that are too small to be the document", () => {
    const tiny: Quad = [
      { x: 300, y: 200 },
      { x: 340, y: 200 },
      { x: 340, y: 240 },
      { x: 300, y: 240 },
    ];
    expect(detectDocument(cv, photo(640, 480, tiny, 5))).toBeNull();
  });
});

describe("processDocument", () => {
  const doc: Quad = [
    { x: 150, y: 90 },
    { x: 620, y: 60 },
    { x: 690, y: 520 },
    { x: 110, y: 540 },
  ];
  const image = photo(800, 600, doc);

  function meanAt(r: Raster, fx: number, fy: number) {
    const x = Math.floor(r.width * fx);
    const y = Math.floor(r.height * fy);
    const i = (y * r.width + x) * 4;
    return (r.data[i]! + r.data[i + 1]! + r.data[i + 2]!) / 3;
  }

  it("rectifies the document to its edge lengths and removes the background", () => {
    const out = processDocument(cv, image, { quad: doc, rotation: 0, filter: "color" });
    expect(out.width).toBeGreaterThan(560);
    expect(out.width).toBeLessThan(600);
    expect(out.height).toBeGreaterThan(450);
    expect(out.height).toBeLessThan(500);
    expect(out.data.length).toBe(out.width * out.height * 4);
    // Corners of the result are paper, not desk.
    for (const [fx, fy] of [
      [0.03, 0.05],
      [0.97, 0.05],
      [0.97, 0.95],
      [0.03, 0.95],
    ] as const)
      expect(meanAt(out, fx, fy)).toBeGreaterThan(180);
  });

  it("rotates by quarter turns", () => {
    const upright = processDocument(cv, image, { quad: doc, rotation: 0, filter: "color" });
    const turned = processDocument(cv, image, { quad: doc, rotation: 90, filter: "color" });
    expect(turned.width).toBe(upright.height);
    expect(turned.height).toBe(upright.width);
    const half = processDocument(cv, image, { quad: doc, rotation: 180, filter: "color" });
    expect(half.width).toBe(upright.width);
  });

  it("produces neutral pixels with the grayscale filter", () => {
    const out = processDocument(cv, image, {
      quad: fullQuad(800, 600),
      rotation: 0,
      filter: "gray",
    });
    for (let i = 0; i < out.data.length; i += 4 * 997) {
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i + 1]).toBe(out.data[i + 2]);
    }
  });

  it("produces pure black and white with the b/w filter", () => {
    const out = processDocument(cv, image, { quad: doc, rotation: 0, filter: "bw" });
    const values = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) values.add(out.data[i]!);
    expect([...values].sort()).toEqual([0, 255]);
  });

  it("keeps the size with the contrast filter", () => {
    const plain = processDocument(cv, image, { quad: doc, rotation: 0, filter: "color" });
    const out = processDocument(cv, image, { quad: doc, rotation: 0, filter: "contrast" });
    expect([out.width, out.height]).toEqual([plain.width, plain.height]);
  });
});
