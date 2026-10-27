import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist";
import i18n from "@/i18n";
import PdfReader from "./PdfReader";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/pdf.worker.mjs" }));

type Observer = { element: Element; callback: IntersectionObserverCallback; disconnected: boolean };
let observers: Observer[];
let cancel: ReturnType<typeof vi.fn>;
let destroy: ReturnType<typeof vi.fn>;
let renderPage: ReturnType<typeof vi.fn>;
let getPage: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  observers = [];
  vi.stubGlobal("__PDFJS_ASSET_BASE__", "/pdfjs/test/");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      record: Observer | undefined;
      constructor(private callback: IntersectionObserverCallback) {}
      observe(element: Element) {
        this.record = { element, callback: this.callback, disconnected: false };
        observers.push(this.record);
      }
      disconnect() {
        if (this.record) this.record.disconnected = true;
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  cancel = vi.fn();
  destroy = vi.fn().mockResolvedValue(undefined);
  renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel }));
  getPage = vi.fn().mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 900 * scale }),
    render: renderPage,
  });
  vi.mocked(getDocument).mockReturnValue({
    promise: Promise.resolve({ numPages: 12, getPage }),
    destroy,
  } as unknown as ReturnType<typeof getDocument>);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function intersection(index: number, visible: boolean) {
  const observer = observers[index]!;
  act(() =>
    observer.callback(
      [{ isIntersecting: visible, target: observer.element } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
}

describe("PdfReader", () => {
  it("offers all pages, including pages beyond OCR's limit, without an embedded browser viewer", async () => {
    render(<PdfReader url="/api/files/test.pdf" />);
    expect(await screen.findByText("12 pages")).toBeInTheDocument();
    expect(screen.getByText("Page 12")).toBeInTheDocument();
    expect(document.querySelector("iframe, object, embed")).toBeNull();
    expect(getPage).not.toHaveBeenCalled();
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/files/test.pdf",
        cMapUrl: "/pdfjs/test/cmaps/",
        wasmUrl: "/pdfjs/test/wasm/",
      }),
    );
    intersection(11, true);
    expect(await screen.findByRole("img", { name: "Page 12" })).toBeInTheDocument();
    expect(getPage).toHaveBeenCalledWith(12);
  });

  it("releases off-screen canvases and cancels rendering on close", async () => {
    const view = render(<PdfReader url="/a.pdf" />);
    await screen.findByText("12 pages");
    intersection(0, true);
    const canvas = await screen.findByRole("img", { name: "Page 1" });
    intersection(0, false);
    expect(canvas).not.toBeInTheDocument();
    expect(canvas).toHaveAttribute("width", "0");
    expect(cancel).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(destroy).toHaveBeenCalledOnce();
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it("zooms, fits width and bounds the canvas backing store", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(6000);
    vi.stubGlobal("devicePixelRatio", 3);
    render(<PdfReader url="/a.pdf" />);
    await screen.findByText("12 pages");
    intersection(0, true);
    await screen.findByRole("img", { name: "Page 1" });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    const canvas = document.querySelector("canvas")!;
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000);
    fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("shows loading failures explicitly and destroys the loading task", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.reject(new Error("invalid PDF")),
      destroy,
    } as unknown as ReturnType<typeof getDocument>);
    const view = render(<PdfReader url="/broken.pdf" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("Loading PDF…")).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
    view.unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("cancels a pending render when closing and ignores its later rejection", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let reject: (error: Error) => void = () => {};
    renderPage.mockReturnValue({
      promise: new Promise<void>((_resolve, onReject) => {
        reject = onReject;
      }),
      cancel,
    });
    const view = render(<PdfReader url="/a.pdf" />);
    await screen.findByText("12 pages");
    intersection(0, true);
    await screen.findByRole("img", { name: "Page 1" });
    view.unmount();
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("render cancelled")));
    expect(log).not.toHaveBeenCalled();
  });

  it("shows a page render failure without removing the other pages", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getPage.mockRejectedValue(new Error("page failed"));
    render(<PdfReader url="/a.pdf" />);
    await screen.findByText("12 pages");
    intersection(0, true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Page 1 could not be displayed");
    expect(screen.getByText("Page 12")).toBeInTheDocument();
  });
});
