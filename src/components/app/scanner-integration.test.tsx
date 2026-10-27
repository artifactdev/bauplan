import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { analyzeDocument } from "@/lib/ocr.functions";
import { ScanBar } from "./ScanBar";
import { QuickUpload } from "./quick-actions";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  scanned: new File([new Uint8Array([37, 80, 68, 70])], "Scan 2026-03-14 09-05.pdf", {
    type: "application/pdf",
  }),
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      trades: [{ id: "t1", name: "Elektro" }],
      cost_items: [],
      tasks: [],
      documents: [],
      contacts: [],
    },
  }),
  useMutations: () => ({
    upload: { mutateAsync: mocks.upload },
    create: {},
    update: {},
    remove: {},
  }),
}));
vi.mock("@/lib/ocr.functions", () => ({ analyzeDocument: vi.fn() }));
vi.mock("./AssignDialog", () => ({ AssignDialog: () => null }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
// The real scanner needs a camera and OpenCV; here it immediately returns a finished PDF.
vi.mock("./DocumentScanner", () => ({
  DocumentScanner: ({
    open,
    onComplete,
    onOpenChange,
  }: {
    open: boolean;
    onComplete: (f: File) => void;
    onOpenChange: (o: boolean) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onComplete(mocks.scanned);
          onOpenChange(false);
        }}
      >
        finish scan
      </button>
    ) : null,
}));

// Radix form controls measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  mocks.upload.mockResolvedValue({ id: "doc-1" });
});
afterEach(() => cleanup());

describe("scanner save integration", () => {
  it("ScanBar stores the scanned PDF as a document and pre-fills the form from OCR", async () => {
    vi.mocked(analyzeDocument).mockResolvedValue({
      result: { amount: 123.45, vendor: "Baumarkt" },
      error: null,
      warnings: [],
    } as unknown as Awaited<ReturnType<typeof analyzeDocument>>);
    const onFill = vi.fn();
    render(<ScanBar target="expense" onFill={onFill} />);

    fireEvent.click(screen.getByRole("button", { name: /scan document/i }));
    fireEvent.click(screen.getByRole("button", { name: "finish scan" }));

    await waitFor(() => expect(onFill).toHaveBeenCalled());
    expect(mocks.upload).toHaveBeenCalledWith({ file: mocks.scanned, meta: { category: "Beleg" } });
    expect(analyzeDocument).toHaveBeenCalledWith({ data: { documentId: "doc-1" } });
    expect(onFill.mock.calls[0]![0]).toMatchObject({ document_id: "doc-1" });
  });

  it("QuickUpload uploads a scan made from its dialog with the chosen document metadata", async () => {
    render(
      <QuickUpload
        open
        onOpenChange={() => {}}
        initial={{ category: "Rechnung", trade_id: "t1", tags: "Küche", recognize: false }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /scan document/i }));
    // Outside the upload dialog's portal, hence hidden from the a11y tree while the dialog is modal.
    fireEvent.click(await screen.findByRole("button", { name: "finish scan", hidden: true }));
    expect(await screen.findByText(mocks.scanned.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hochladen" }));

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    const { file, meta } = mocks.upload.mock.calls[0]![0] as {
      file: File;
      meta: Record<string, unknown>;
    };
    expect(file).toBe(mocks.scanned);
    expect(meta).toMatchObject({ category: "Rechnung", trade_id: "t1", tags: "Küche" });
    expect(meta).not.toHaveProperty("recognize");
  });

  it("QuickUpload takes over a scan made before opening (documents page)", async () => {
    render(
      <QuickUpload
        open
        onOpenChange={() => {}}
        initialFile={mocks.scanned}
        initial={{ category: "Plan", recognize: false }}
      />,
    );
    expect(await screen.findByText(mocks.scanned.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hochladen" }));
    await waitFor(() =>
      expect(mocks.upload).toHaveBeenCalledWith({
        file: mocks.scanned,
        meta: expect.objectContaining({ category: "Plan" }),
      }),
    );
  });
});
