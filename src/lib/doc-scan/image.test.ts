import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoReader } from "./image";

afterEach(() => vi.restoreAllMocks());

describe("reusable video analysis canvas", () => {
  it("allocates once, resizes only when necessary and releases its backing store", () => {
    const canvas = document.createElement("canvas");
    const width = vi.spyOn(canvas, "width", "set");
    const height = vi.spyOn(canvas, "height", "set");
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({
      width: 640,
      height: 360,
      data: new Uint8ClampedArray(16),
    }));
    vi.spyOn(canvas, "getContext").mockReturnValue({
      drawImage,
      getImageData,
    } as unknown as CanvasRenderingContext2D);
    const create = vi.spyOn(document, "createElement").mockReturnValue(canvas);
    const reader = createVideoReader();
    const video = { videoWidth: 1920, videoHeight: 1080, readyState: 2 } as HTMLVideoElement;
    for (let i = 0; i < 30; i++) reader.read(video, 640);
    expect(create).toHaveBeenCalledOnce();
    expect(width.mock.calls.map((call) => call[0])).toEqual([1, 640]);
    expect(height.mock.calls.map((call) => call[0])).toEqual([1, 360]);
    expect(getImageData).toHaveBeenCalledTimes(30);
    reader.read(video, 480);
    expect(width).toHaveBeenLastCalledWith(480);
    expect(height).toHaveBeenLastCalledWith(270);
    reader.dispose();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
  it("does not read pixels before the camera has usable dimensions and data", () => {
    const canvas = document.createElement("canvas");
    const drawImage = vi.fn();
    vi.spyOn(canvas, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(document, "createElement").mockReturnValue(canvas);
    const reader = createVideoReader();
    expect(
      reader.read({ videoWidth: 0, videoHeight: 0, readyState: 0 } as HTMLVideoElement, 640),
    ).toBeNull();
    expect(drawImage).not.toHaveBeenCalled();
    reader.dispose();
  });
});
