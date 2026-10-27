import { describe, expect, it } from "vitest";
import {
  fitScale,
  fullQuad,
  isConvexQuad,
  isPlausibleDocument,
  moveCorner,
  nextRotation,
  orderCorners,
  quadArea,
  scaleQuad,
  warpSize,
  type Quad,
} from "./geometry";

const square: Quad = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe("doc-scan geometry", () => {
  it("orders corners clockwise from top-left regardless of input order", () => {
    const shuffled = [square[2], square[0], square[3], square[1]];
    expect(orderCorners(shuffled)).toEqual(square);
    const tilted = orderCorners([
      { x: 620, y: 60 },
      { x: 110, y: 540 },
      { x: 150, y: 90 },
      { x: 690, y: 520 },
    ]);
    expect(tilted).toEqual([
      { x: 150, y: 90 },
      { x: 620, y: 60 },
      { x: 690, y: 520 },
      { x: 110, y: 540 },
    ]);
  });

  it("rejects anything but four points", () => {
    expect(() => orderCorners(square.slice(0, 3))).toThrow();
  });

  it("computes area and convexity", () => {
    expect(quadArea(square)).toBe(10_000);
    expect(isConvexQuad(square)).toBe(true);
    const bowTie: Quad = [square[0], square[2], square[1], square[3]];
    expect(isConvexQuad(bowTie)).toBe(false);
    const dart: Quad = [square[0], { x: 30, y: 30 }, square[2], square[3]];
    expect(isConvexQuad(dart)).toBe(false);
  });

  it("checks that a detected document is plausible", () => {
    expect(isPlausibleDocument(square, 200, 200)).toBe(true);
    expect(isPlausibleDocument(scaleQuad(square, 0.2), 200, 200)).toBe(false);
  });

  it("uses the longer opposite edges as output size", () => {
    const trapezoid: Quad = [
      { x: 20, y: 0 },
      { x: 80, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ];
    expect(warpSize(trapezoid)).toEqual({ width: 100, height: 201 });
  });

  it("builds full and inset quads", () => {
    expect(fullQuad(100, 100)).toEqual(square);
    expect(fullQuad(100, 50, 0.1)[0]).toEqual({ x: 10, y: 5 });
  });

  it("fits images without upscaling", () => {
    expect(fitScale(4000, 3000, 2000)).toBe(0.5);
    expect(fitScale(800, 600, 2000)).toBe(1);
  });

  it("caps the pixel area so narrow receipts keep their width", () => {
    expect(fitScale(4000, 3000, 4096, 3_000_000)).toBeCloseTo(Math.sqrt(0.25));
    const receipt = fitScale(1500, 4800, 4096, 6_000_000);
    expect(1500 * receipt).toBeGreaterThan(1200); // was 750 with the old 2400 px long-side cap
    expect(1500 * 4800 * receipt ** 2).toBeLessThanOrEqual(6_000_000 + 1);
  });

  it("rotates in quarter turns both ways", () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(270)).toBe(0);
    expect(nextRotation(0, -1)).toBe(270);
  });

  it("keeps moved corners inside the image", () => {
    const moved = moveCorner(square, 2, { x: 150, y: -5 }, 120, 120);
    expect(moved[2]).toEqual({ x: 120, y: 0 });
    expect(square[2]).toEqual({ x: 100, y: 100 });
  });
});
