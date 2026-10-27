import {
  DETECT_SIDE,
  fitScale,
  fullQuad,
  isPlausibleDocument,
  orderCorners,
  quadArea,
  scaleQuad,
  warpSize,
  type Point,
  type Quad,
  type Rotation,
  type ScanFilter,
} from "./geometry";

/** RGBA pixels; structurally compatible with the browser ImageData. */
export type Raster = { data: Uint8ClampedArray; width: number; height: number };

// OpenCV.js ships incomplete typings for the 5.x runtime, so the module is typed loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Cv = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mat = any;

/** Resolves the OpenCV.js module export (Promise or object with onRuntimeInitialized). */
export async function resolveCv(mod: unknown): Promise<Cv> {
  const m = (mod as { default?: unknown })?.default ?? mod;
  if (m instanceof Promise) return await m;
  const cv = m as Cv;
  if (cv.Mat) return cv;
  await new Promise<void>((resolve) => {
    cv.onRuntimeInitialized = () => resolve();
  });
  return cv;
}

function track<T extends Mat>(list: Mat[], mat: T): T {
  list.push(mat);
  return mat;
}

function release(list: Mat[]) {
  for (const m of list) {
    try {
      m.delete();
    } catch {
      /* already released */
    }
  }
}

function matToPoints(mat: Mat): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < mat.rows; i++) out.push({ x: mat.data32S[i * 2], y: mat.data32S[i * 2 + 1] });
  return out;
}

/** Four-corner approximation of a contour (via its convex hull), or null. */
function quadFromContour(cv: Cv, contour: Mat, mats: Mat[]): Quad | null {
  const hull = track(mats, new cv.Mat());
  cv.convexHull(contour, hull, false, true);
  const perimeter = cv.arcLength(hull, true);
  const approx = track(mats, new cv.Mat());
  for (const epsilon of [0.015, 0.02, 0.03, 0.045, 0.06, 0.08]) {
    cv.approxPolyDP(hull, approx, epsilon * perimeter, true);
    if (approx.rows === 4) return orderCorners(matToPoints(approx));
    if (approx.rows < 4) return null;
  }
  return null;
}

/** Candidate binary maps: edges (Canny) and brightness segmentation (Otsu, both polarities). */
function* edgeMaps(cv: Cv, gray: Mat, mats: Mat[]): Generator<Mat> {
  const kernel = track(mats, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
  const canny = track(mats, new cv.Mat());
  cv.Canny(gray, canny, 8, 24);
  cv.dilate(canny, canny, kernel);
  yield canny;
  const otsu = track(mats, new cv.Mat());
  cv.threshold(gray, otsu, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
  cv.morphologyEx(otsu, otsu, cv.MORPH_CLOSE, kernel);
  yield otsu;
  const inverted = track(mats, new cv.Mat());
  cv.bitwise_not(otsu, inverted);
  yield inverted;
}

/**
 * Finds the four corners of the dominant document in the image.
 * Returns null when no plausible quadrilateral (convex, ≥ 10 % of the image) is found.
 */
export type DocumentDetection = {
  quad: Quad;
  /** Heuristic ranking, not a probability. */
  score: number;
  complete: boolean;
  /** Variance of the sampled interior Laplacian, before blur. */
  sharpness: number;
};

function boundaryContrast(gray: Mat, quad: Quad): number {
  const center = quad.reduce((p, q) => ({ x: p.x + q.x / 4, y: p.y + q.y / 4 }), { x: 0, y: 0 });
  const sample = (x: number, y: number) =>
    gray.data[
      Math.min(gray.rows - 1, Math.max(0, Math.round(y))) * gray.cols +
        Math.min(gray.cols - 1, Math.max(0, Math.round(x)))
    ] as number;
  let contrast = 0;
  for (let edge = 0; edge < 4; edge++) {
    const a = quad[edge]!;
    const b = quad[(edge + 1) % 4]!;
    let supported = 0;
    for (let i = 1; i < 10; i++) {
      const x = a.x + ((b.x - a.x) * i) / 10;
      const y = a.y + ((b.y - a.y) * i) / 10;
      const length = Math.hypot(center.x - x, center.y - y);
      const dx = ((center.x - x) / length) * 5;
      const dy = ((center.y - y) / length) * 5;
      supported += Math.abs(sample(x + dx, y + dy) - sample(x - dx, y - dy));
    }
    contrast += Math.min(1, supported / 9 / 35);
  }
  return contrast / 4;
}

function interiorSharpness(gray: Mat, quad: Quad): number {
  let sum = 0;
  let square = 0;
  let count = 0;
  // Sample inside the page, excluding its boundary so a sharp desk edge cannot mask blurred text.
  for (let v = 0.1; v < 0.9; v += 0.015) {
    for (let u = 0.1; u < 0.9; u += 0.015) {
      const [a, b, c, d] = quad;
      const x = Math.round((1 - v) * (a.x * (1 - u) + b.x * u) + v * (d.x * (1 - u) + c.x * u));
      const y = Math.round((1 - v) * (a.y * (1 - u) + b.y * u) + v * (d.y * (1 - u) + c.y * u));
      if (x < 1 || y < 1 || x >= gray.cols - 1 || y >= gray.rows - 1) continue;
      const i = y * gray.cols + x;
      const laplacian =
        gray.data[i - 1] +
        gray.data[i + 1] +
        gray.data[i - gray.cols] +
        gray.data[i + gray.cols] -
        4 * gray.data[i];
      sum += laplacian;
      square += laplacian * laplacian;
      count++;
    }
  }
  return count ? square / count - (sum / count) ** 2 : 0;
}

export function detectDocumentDetails(cv: Cv, image: Raster): DocumentDetection | null {
  const mats: Mat[] = [];
  try {
    const src = track(mats, cv.matFromImageData(image));
    const scale = fitScale(image.width, image.height, DETECT_SIDE);
    const small = scale === 1 ? src : track(mats, new cv.Mat());
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    if (scale !== 1) cv.resize(src, small, new cv.Size(width, height), 0, 0, cv.INTER_AREA);
    const gray = track(mats, new cv.Mat());
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    const rawGray = track(mats, gray.clone());
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    const imageArea = width * height;
    let best: { quad: Quad; score: number; complete: boolean } | null = null;
    for (const map of edgeMaps(cv, gray, mats)) {
      const contours = track(mats, new cv.MatVector());
      const hierarchy = track(mats, new cv.Mat());
      cv.findContours(map, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const candidates: { index: number; area: number }[] = [];
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        try {
          const area = cv.contourArea(contour);
          if (area >= imageArea * 0.1) candidates.push({ index: i, area });
        } finally {
          contour.delete();
        }
      }
      // Only a bounded number of large candidates need hull/quad approximation.
      for (const { index, area } of candidates.sort((a, b) => b.area - a.area).slice(0, 12)) {
        const temporary: Mat[] = [];
        try {
          const contour = track(temporary, contours.get(index));
          const quad = quadFromContour(cv, contour, temporary);
          if (!quad || !isPlausibleDocument(quad, width, height)) continue;
          const qArea = quadArea(quad);
          if (qArea > imageArea * 0.97 || area / qArea < 0.8) continue;
          const complete = quad.every(
            (p) =>
              p.x > width * 0.015 &&
              p.x < width * 0.985 &&
              p.y > height * 0.015 &&
              p.y < height * 0.985,
          );
          const edges = boundaryContrast(rawGray, quad);
          const score =
            0.35 * Math.min(1, qArea / imageArea / 0.65) +
            0.2 * Math.min(1, area / qArea) +
            0.35 * edges +
            (complete ? 0.1 : 0);
          if (edges < 0.12) continue;
          if (!best || score > best.score) best = { quad, score, complete };
        } finally {
          release(temporary);
        }
      }
      // A well-supported complete outline does not need the other segmentation passes.
      if (best && best.complete && best.score >= 0.9) break;
    }
    return best
      ? {
          quad: scaleQuad(best.quad, 1 / scale),
          score: best.score,
          complete: best.complete,
          sharpness: interiorSharpness(rawGray, best.quad),
        }
      : null;
  } finally {
    release(mats);
  }
}

export function detectDocument(cv: Cv, image: Raster): Quad | null {
  return detectDocumentDetails(cv, image)?.quad ?? null;
}

const ROTATE_CODES: Record<Exclude<Rotation, 0>, string> = {
  90: "ROTATE_90_CLOCKWISE",
  180: "ROTATE_180",
  270: "ROTATE_90_COUNTERCLOCKWISE",
};

function applyFilter(cv: Cv, rgba: Mat, filter: ScanFilter, mats: Mat[]): Mat {
  if (filter === "color") return rgba;
  const out = track(mats, new cv.Mat());
  if (filter === "contrast") {
    const rgb = track(mats, new cv.Mat());
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    const lab = track(mats, new cv.Mat());
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    const channels = track(mats, new cv.MatVector());
    cv.split(lab, channels);
    const l = track(mats, channels.get(0));
    const clahe = track(mats, new cv.CLAHE(2.5, new cv.Size(8, 8)));
    const lEnhanced = track(mats, new cv.Mat());
    clahe.apply(l, lEnhanced);
    channels.set(0, lEnhanced);
    cv.merge(channels, lab);
    cv.cvtColor(lab, rgb, cv.COLOR_Lab2RGB);
    cv.cvtColor(rgb, out, cv.COLOR_RGB2RGBA);
    return out;
  }
  const gray = track(mats, new cv.Mat());
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  if (filter === "bw") {
    const block = Math.max(15, Math.round(Math.min(gray.cols, gray.rows) / 30) | 1);
    cv.adaptiveThreshold(
      gray,
      gray,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      block,
      12,
    );
  }
  cv.cvtColor(gray, out, cv.COLOR_GRAY2RGBA);
  return out;
}

export type ProcessOptions = { quad: Quad; rotation: Rotation; filter: ScanFilter };

/** Perspective-corrects the quad region, then rotates and filters it. */
export function processDocument(cv: Cv, image: Raster, options: ProcessOptions): Raster {
  const mats: Mat[] = [];
  try {
    const src = track(mats, cv.matFromImageData(image));
    const quad = options.quad ?? fullQuad(image.width, image.height);
    const { width, height } = warpSize(quad);
    const from = track(
      mats,
      cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        quad.flatMap((p) => [p.x, p.y]),
      ),
    );
    const to = track(
      mats,
      cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        width - 1,
        0,
        width - 1,
        height - 1,
        0,
        height - 1,
      ]),
    );
    const matrix = track(mats, cv.getPerspectiveTransform(from, to));
    let current = track(mats, new cv.Mat());
    cv.warpPerspective(
      src,
      current,
      matrix,
      new cv.Size(width, height),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar(),
    );
    if (options.rotation !== 0) {
      const rotated = track(mats, new cv.Mat());
      cv.rotate(current, rotated, cv[ROTATE_CODES[options.rotation]]);
      current = rotated;
    }
    const result = applyFilter(cv, current, options.filter, mats);
    return {
      data: new Uint8ClampedArray(result.data),
      width: result.cols,
      height: result.rows,
    };
  } finally {
    release(mats);
  }
}
