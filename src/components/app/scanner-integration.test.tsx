import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { analyzeDocument } from "@/lib/ocr.functions";
import { ScanBar } from "./ScanBar";
import { QuickUpload } from "./quick-actions";
import { EntityDialog } from "./EntityDialog";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
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
    remove: { mutateAsync: mocks.remove },
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

  describe("cancelling a create form after uploading", () => {
    async function openAndScan(onOpenChange = vi.fn()) {
      vi.mocked(analyzeDocument).mockResolvedValue({ result: null, error: null, warnings: [] } as unknown as Awaited<ReturnType<typeof analyzeDocument>>);
      render(<EntityDialog open onOpenChange={onOpenChange} title="New expense" fields={[]} onSubmit={() => {}} scan="expense" />);
      fireEvent.click(screen.getByRole("button", { name: /scan document/i }));
      fireEvent.click(await screen.findByRole("button", { name: "finish scan", hidden: true }));
      await screen.findByText(mocks.scanned.name);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await screen.findByRole("alertdialog");
      return onOpenChange;
    }

    it("deletes the uploaded document when the user chooses so", async () => {
      mocks.remove.mockResolvedValue({ ok: true });
      const onOpenChange = await openAndScan();
      expect(screen.getByRole("alertdialog")).toHaveTextContent(mocks.scanned.name);
      fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(mocks.remove).toHaveBeenCalledWith({ table: "documents", id: "doc-1" });
    });

    it("keeps the document when the user chooses so", async () => {
      const onOpenChange = await openAndScan();
      fireEvent.click(screen.getByRole("button", { name: "Keep" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(mocks.remove).not.toHaveBeenCalled();
    });

    it("asks on Escape / background close too, even after the page re-renders with a new initial", async () => {
      vi.mocked(analyzeDocument).mockResolvedValue({ result: null, error: null, warnings: [] } as unknown as Awaited<ReturnType<typeof analyzeDocument>>);
      const onOpenChange = vi.fn();
      const view = render(<EntityDialog open onOpenChange={onOpenChange} title="New expense" fields={[]} initial={{}} onSubmit={() => {}} scan="expense" />);
      fireEvent.click(screen.getByRole("button", { name: /scan document/i }));
      fireEvent.click(await screen.findByRole("button", { name: "finish scan", hidden: true }));
      await screen.findByText(mocks.scanned.name);
      view.rerender(<EntityDialog open onOpenChange={onOpenChange} title="New expense" fields={[]} initial={{}} onSubmit={() => {}} scan="expense" />);
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("waits for a running upload before offering to delete it", async () => {
      let finish!: (v: { id: string }) => void;
      mocks.upload.mockReturnValue(new Promise((r) => { finish = r; }));
      mocks.remove.mockResolvedValue({ ok: true });
      vi.mocked(analyzeDocument).mockResolvedValue({ result: null, error: null, warnings: [] } as unknown as Awaited<ReturnType<typeof analyzeDocument>>);
      const onOpenChange = vi.fn();
      render(<EntityDialog open onOpenChange={onOpenChange} title="New expense" fields={[]} onSubmit={() => {}} scan="expense" />);
      fireEvent.click(screen.getByRole("button", { name: /scan document/i }));
      fireEvent.click(await screen.findByRole("button", { name: "finish scan", hidden: true }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await screen.findByRole("alertdialog")).toHaveTextContent(/still uploading/);
      expect(screen.getByRole("button", { name: "Delete document" })).toBeDisabled();
      finish({ id: "doc-1" });
      await waitFor(() => expect(screen.getByRole("button", { name: "Delete document" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(mocks.remove).toHaveBeenCalledWith({ table: "documents", id: "doc-1" });
    });

    it("asks for documents handed in as freshly uploaded (assign step after upload)", async () => {
      mocks.remove.mockResolvedValue({ ok: true });
      const onOpenChange = vi.fn();
      render(<EntityDialog open onOpenChange={onOpenChange} title="Assign" fields={[]} onSubmit={() => {}} uploaded={[{ id: "doc-9", name: "beleg.pdf" }]} />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await screen.findByRole("alertdialog")).toHaveTextContent("beleg.pdf");
      fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
      await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ table: "documents", id: "doc-9" }));
    });

    it("returns to the form on 'Keep editing'", async () => {
      const onOpenChange = await openAndScan();
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    });
  });

  it("closes without asking when nothing was uploaded", () => {
    const onOpenChange = vi.fn();
    render(<EntityDialog open onOpenChange={onOpenChange} title="New expense" fields={[]} onSubmit={() => {}} scan="expense" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("logs the OCR result to the console in dev builds", async () => {
    const group = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(analyzeDocument).mockResolvedValue({ result: { amount: 9 }, error: null, warnings: [], text: "Summe 9,00" } as unknown as Awaited<ReturnType<typeof analyzeDocument>>);
    const onFill = vi.fn();
    render(<ScanBar target="expense" onFill={onFill} />);
    fireEvent.click(screen.getByRole("button", { name: /scan document/i }));
    fireEvent.click(screen.getByRole("button", { name: "finish scan" }));
    await waitFor(() => expect(onFill).toHaveBeenCalled());
    expect(group).toHaveBeenCalledWith(`[OCR] ${mocks.scanned.name}`);
    expect(log).toHaveBeenCalledWith("extraction", { amount: 9 });
    expect(log).toHaveBeenCalledWith("text\nSumme 9,00");
    group.mockRestore();
    log.mockRestore();
  });
});
