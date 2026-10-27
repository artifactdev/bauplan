export type Point = { x: number; y: number };
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];
export type Rotation = 0 | 90 | 180 | 270;
export type ScanFilter = "color" | "gray" | "contrast" | "bw";

export const SCAN_FILTERS: readonly ScanFilter[] = ["color", "gray", "contrast", "bw"];
/** Longest image side kept in memory and processed; larger photos are downscaled. */
export const MAX_SOURCE_SIDE = 2400;
/** Longest side used for corner detection (speed over precision; corners are scaled back). */
export const DETECT_SIDE = 640;
export const MAX_SCAN_PAGES = 20;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Sorts four arbitrary points into top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(points: Point[]): Quad {
  if (points.length !== 4) throw new Error("Four points expected");
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const byAngle = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  // Clockwise in screen coordinates, starting at the point with the smallest x + y.
  let start = 0;
  byAngle.forEach((p, i) => {
    if (p.x + p.y < byAngle[start]!.x + byAngle[start]!.y) start = i;
  });
  const o = [0, 1, 2, 3].map((i) => byAngle[(start + i) % 4]!);
  return [o[0]!, o[1]!, o[2]!, o[3]!];
}

export function quadArea(q: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    const c = q[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Whole image as quad, optionally inset by a fraction of each side. */
export function fullQuad(width: number, height: number, inset = 0): Quad {
  const dx = width * inset;
  const dy = height * inset;
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ];
}

export function scaleQuad(q: Quad, factor: number): Quad {
  return q.map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad;
}

export function clampPoint(p: Point, width: number, height: number): Point {
  return { x: Math.min(width, Math.max(0, p.x)), y: Math.min(height, Math.max(0, p.y)) };
}

/** Output size of the rectified document: the longer of each pair of opposite edges. */
export function warpSize(q: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = q;
  return {
    width: Math.max(1, Math.round(Math.max(dist(tl, tr), dist(bl, br)))),
    height: Math.max(1, Math.round(Math.max(dist(tl, bl), dist(tr, br)))),
  };
}

/** Scale factor that fits width × height into maxSide (never upscales). */
export function fitScale(width: number, height: number, maxSide: number): number {
  return Math.min(1, maxSide / Math.max(width, height));
}

export function nextRotation(r: Rotation, direction: 1 | -1 = 1): Rotation {
  return ((((r + direction * 90) % 360) + 360) % 360) as Rotation;
}

/** Plausibility check for detected documents: big enough and convex. */
export function isPlausibleDocument(q: Quad, width: number, height: number, minAreaRatio = 0.1) {
  return isConvexQuad(q) && quadArea(q) >= width * height * minAreaRatio;
}

/** Moves one corner while keeping it inside the image. */
export function moveCorner(q: Quad, index: number, to: Point, width: number, height: number): Quad {
  const next = [...q] as Quad;
  next[index] = clampPoint(to, width, height);
  return next;
}
