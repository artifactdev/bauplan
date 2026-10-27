import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { Route } from "./dokumente";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  resolveFileUrl: vi.fn(),
}));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      documents: [
        {
          id: "document-1",
          name: "Invoice.pdf",
          mime_type: "application/pdf",
          storage_path: "invoice.pdf",
          size: 1024,
          category: null,
          tags: null,
          description: null,
          trade_id: null,
          cost_item_id: null,
          task_id: null,
          created_at: "2026-10-27",
        },
      ],
      trades: [],
      cost_items: [],
      tasks: [],
      offers: [],
      expenses: [],
    },
  }),
  useMutations: () => ({ update: {}, remove: { mutate: mocks.remove } }),
}));
vi.mock("@/components/app/doc-open", () => ({ resolveFileUrl: mocks.resolveFileUrl }));
vi.mock("@/components/app/EntityDialog", () => ({
  EntityDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="edit-dialog" /> : null),
}));
vi.mock("@/components/app/AssignDialog", () => ({
  AssignDialog: ({ documentId }: { documentId: string | null }) =>
    documentId ? <div data-testid="assign-dialog" /> : null,
}));
vi.mock("@/components/app/quick-actions", () => ({ QuickUpload: () => null }));
vi.mock("@/components/app/DocumentScanner", () => ({ DocumentScanner: () => null }));
vi.mock("@/components/app/DocumentPreview", () => ({ DocumentPreview: () => null }));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.resolveFileUrl.mockResolvedValue("/api/files/invoice.pdf");
  vi.spyOn(window, "open").mockImplementation(() => null);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openMenu() {
  const Page = Route.options.component!;
  render(<Page />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
    button: 0,
    ctrlKey: false,
  });
  return await screen.findByRole("menu");
}

describe("document actions menu", () => {
  it("closes when clicking outside", async () => {
    await openMenu();
    fireEvent.pointerDown(document.body, { button: 0 });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus());
  });

  it.each(["recognize", "download", "edit", "delete"] as const)(
    "closes after selecting %s and executes the action",
    async (action) => {
      await openMenu();
      const items = screen.getAllByRole("menuitem");
      fireEvent.click(items[["recognize", "download", "edit", "delete"].indexOf(action)]!);
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
      if (action === "recognize") expect(screen.getByTestId("assign-dialog")).toBeInTheDocument();
      if (action === "edit") expect(screen.getByTestId("edit-dialog")).toBeInTheDocument();
      if (action === "download")
        await waitFor(() =>
          expect(window.open).toHaveBeenCalledWith("/api/files/invoice.pdf", "_blank"),
        );
      if (action === "delete")
        expect(mocks.remove).toHaveBeenCalledWith({ table: "documents", id: "document-1" });
    },
  );

  it("also closes when deletion is cancelled without removing the document", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await openMenu();
    fireEvent.click(screen.getAllByRole("menuitem")[3]!);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
