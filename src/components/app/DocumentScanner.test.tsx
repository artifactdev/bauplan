import { createCanvas } from "@napi-rs/canvas";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { Raster } from "@/lib/doc-scan/cv-ops";
import { decodeImage, encodeJpeg } from "@/lib/doc-scan/image";
import { detectQuad, disposeScanner, processScan } from "@/lib/doc-scan/scan-engine";
import { DocumentScanner } from "./DocumentScanner";

vi.mock("@/lib/doc-scan/scan-engine", () => ({
  warmUpScanner: vi.fn(async () => {}),
  detectQuad: vi.fn(),
  processScan: vi.fn(),
  disposeScanner: vi.fn(),
}));
vi.mock("@/lib/doc-scan/image", () => ({
  decodeImage: vi.fn(),
  encodeJpeg: vi.fn(),
  grabVideoFrame: vi.fn(),
}));

const raster = (width: number, height: number): Raster => ({
  data: new Uint8ClampedArray(width * height * 4),
  width,
  height,
});
const quad = [
  { x: 10, y: 10 },
  { x: 90, y: 12 },
  { x: 88, y: 140 },
  { x: 12, y: 138 },
] as const;

function jpegBlob(width = 40, height = 56) {
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").fillRect(0, 0, width, height);
  const bytes = new Uint8Array(canvas.toBuffer("image/jpeg"));
  return new Blob([bytes], { type: "image/jpeg" });
}

function importImage(name = "page.jpg") {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "image/jpeg" })] } });
}

// jsdom's Blob lacks arrayBuffer(), which all supported browsers provide.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

let urls = 0;
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  URL.createObjectURL = vi.fn(() => `blob:test/${++urls}`);
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(decodeImage).mockResolvedValue(raster(100, 150));
  vi.mocked(encodeJpeg).mockImplementation(async () => jpegBlob());
  vi.mocked(detectQuad).mockResolvedValue([...quad]);
  vi.mocked(processScan).mockResolvedValue(raster(80, 130));
});
afterEach(() => cleanup());

describe("DocumentScanner", () => {
  it("falls back to image import when no camera API is available", async () => {
    render(<DocumentScanner open onOpenChange={() => {}} onComplete={() => {}} />);
    expect(await screen.findByText(/camera is not available here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import image/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /take photo/i })).toBeDisabled();
  });

  it("explains a denied camera permission", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")) },
    });
    render(<DocumentScanner open onOpenChange={() => {}} onComplete={() => {}} />);
    expect(await screen.findByText(/no access to the camera/i)).toBeInTheDocument();
  });

  it("stops the camera when the scanner closes", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { rerender } = render(
      <DocumentScanner open onOpenChange={() => {}} onComplete={() => {}} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /take photo/i })).toBeEnabled());
    rerender(<DocumentScanner open={false} onOpenChange={() => {}} onComplete={() => {}} />);
    expect(stop).toHaveBeenCalled();
    expect(disposeScanner).toHaveBeenCalled();
  });

  it("detects, crops and saves several pages as one PDF in the chosen order", async () => {
    const onComplete = vi.fn();
    const onOpenChange = vi.fn();
    render(<DocumentScanner open onOpenChange={onOpenChange} onComplete={onComplete} />);

    importImage("first.jpg");
    await screen.findByRole("img", { name: "Result" });
    expect(processScan).toHaveBeenCalledWith(expect.anything(), {
      quad: [...quad],
      rotation: 0,
      filter: "color",
    });
    fireEvent.click(screen.getByRole("button", { name: /add page/i }));

    vi.mocked(processScan).mockResolvedValueOnce(raster(160, 90));
    importImage("second.jpg");
    await screen.findByRole("img", { name: "Result" });
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));

    expect(await screen.findByRole("img", { name: "Page 2" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /move earlier/i })[1]!);
    fireEvent.click(screen.getByRole("button", { name: /use as pdf/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const file = onComplete.mock.calls[0]![0] as File;
    expect(file.type).toBe("application/pdf");
    expect(file.name).toMatch(/^Scan \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.pdf$/);
    const pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(2);
    // The landscape second page was moved to the front.
    const [first] = pdf.getPages().map((p) => p.getSize());
    expect(first!.width).toBeGreaterThan(first!.height);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the original photo for manual cropping when no document is found", async () => {
    vi.mocked(detectQuad).mockResolvedValue(null);
    render(<DocumentScanner open onOpenChange={() => {}} onComplete={() => {}} />);
    importImage();
    expect(await screen.findByText(/no document edges detected/i)).toBeInTheDocument();
    expect(processScan).toHaveBeenCalledWith(expect.anything(), {
      quad: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 150 },
        { x: 0, y: 150 },
      ],
      rotation: 0,
      filter: "color",
    });
    const corner = screen.getByRole("button", { name: /top-left corner/i });
    fireEvent.keyDown(corner, { key: "ArrowRight", shiftKey: true });
    await waitFor(() =>
      expect(processScan).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          quad: expect.arrayContaining([{ x: 7.5, y: 0 }]),
        }),
      ),
    );
  });

  it("re-renders with rotation and filter changes", async () => {
    render(<DocumentScanner open onOpenChange={() => {}} onComplete={() => {}} />);
    importImage();
    await screen.findByRole("img", { name: "Result" });
    fireEvent.click(screen.getByRole("button", { name: /rotate right/i }));
    fireEvent.click(screen.getByRole("radio", { name: /black & white/i }));
    await waitFor(() =>
      expect(processScan).toHaveBeenLastCalledWith(expect.anything(), {
        quad: [...quad],
        rotation: 90,
        filter: "bw",
      }),
    );
  });

  it("asks before discarding scanned pages", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const onOpenChange = vi.fn();
    render(<DocumentScanner open onOpenChange={onOpenChange} onComplete={() => {}} />);
    importImage();
    await screen.findByRole("img", { name: "Result" });
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
