import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { Route } from "./dokumente";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  resolveFileUrl: vi.fn(),
  paperlessEnabled: false,
  paperlessAllowed: true,
  paperlessConfigured: false,
  paperlessError: null as Error | null,
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
vi.mock("@/hooks/use-paperless", () => ({
  usePaperlessSettings: () => ({
    data: {
      allowed: mocks.paperlessAllowed,
      configured: mocks.paperlessConfigured,
      enabled: mocks.paperlessEnabled,
      connected: false,
    },
    error: null,
  }),
  usePaperlessDocuments: () => ({
    data: [
      {
        documentId: "document-1",
        link: { remoteId: 8, url: "https://paperless.example.test/documents/8/details" },
        job: null,
        verification: null,
      },
    ],
    error: mocks.paperlessError,
    isError: mocks.paperlessError !== null,
  }),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.removeItem("bauplan.documents.view");
  mocks.paperlessEnabled = false;
  mocks.paperlessAllowed = true;
  mocks.paperlessConfigured = false;
  mocks.paperlessError = null;
  await i18n.changeLanguage("en");
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
    button: 0,
    ctrlKey: false,
  });
  return await screen.findByRole("menu");
}

describe("document actions menu", () => {
  it("remembers the last view across unmounts and restores the list when selected again", () => {
    const Page = Route.options.component!;
    const show = () =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <Page />
        </QueryClientProvider>,
      );
    let rendered = show();
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    fireEvent.click(screen.getByRole("radio", { name: "Card view" }));
    expect(localStorage.getItem("bauplan.documents.view")).toBe("cards");
    rendered.unmount();
    rendered = show();
    expect(screen.getByRole("radio", { name: "Card view" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(localStorage.getItem("bauplan.documents.view")).toBe("list");
    rendered.unmount();
    show();
    expect(screen.getByRole("radio", { name: "List view" })).toBeChecked();
  });

  it("uses the default cards if the stored preference is invalid", () => {
    localStorage.setItem("bauplan.documents.view", "invalid");
    const Page = Route.options.component!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("radio", { name: "Card view" })).toBeChecked();
  });

  it("defaults to cards and keeps filters and Paperless selections when changing views", () => {
    mocks.paperlessEnabled = true;
    const Page = Route.options.component!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>,
    );
    const list = screen.getByRole("radio", { name: "List view" });
    const cards = screen.getByRole("radio", { name: "Card view" });
    expect(cards).toBeChecked();
    expect(screen.getByRole("radiogroup", { name: "Document view" })).toHaveClass("ml-auto");
    fireEvent.click(list);
    fireEvent.change(screen.getByPlaceholderText("Search by name, tag…"), {
      target: { value: "Invoice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Paperless" }));
    fireEvent.click(screen.getByLabelText("Select Invoice.pdf"));
    fireEvent.click(cards);
    expect(cards).toBeChecked();
    expect(screen.getByRole("list", { name: "Documents" })).toHaveClass("grid");
    expect(screen.getByLabelText("Select Invoice.pdf")).toBeChecked();
    expect(screen.getByPlaceholderText("Search by name, tag…")).toHaveValue("Invoice");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(cards);
    expect(cards).toBeChecked();
    fireEvent.click(list);
    expect(list).toBeChecked();
    expect(screen.getByRole("list", { name: "Documents" })).toHaveClass("divide-y");
    expect(screen.getByLabelText("Select Invoice.pdf")).toBeChecked();
  });

  it.each(["recognize", "preview", "download", "edit", "delete"] as const)(
    "keeps the %s action working in card view",
    async (action) => {
      const Page = Route.options.component!;
      render(
        <QueryClientProvider client={new QueryClient()}>
          <Page />
        </QueryClientProvider>,
      );
      fireEvent.click(screen.getByRole("radio", { name: "Card view" }));
      const labels = {
        recognize: "Recognize and assign content",
        preview: "Preview",
        download: "Download",
        edit: "Edit",
        delete: "Delete",
      };
      fireEvent.click(screen.getAllByRole("button", { name: labels[action] }).at(-1)!);
      if (action === "recognize") expect(screen.getByTestId("assign-dialog")).toBeInTheDocument();
      if (action === "edit") expect(screen.getByTestId("edit-dialog")).toBeInTheDocument();
      if (action === "preview" || action === "download")
        await waitFor(() => expect(mocks.resolveFileUrl).toHaveBeenCalledWith("invoice.pdf"));
      if (action === "delete")
        expect(mocks.remove).toHaveBeenCalledWith({ table: "documents", id: "document-1" });
    },
  );
  it("hides Paperless for denied members while keeping shared local documents usable", () => {
    mocks.paperlessEnabled = true;
    mocks.paperlessConfigured = true;
    mocks.paperlessAllowed = false;
    mocks.paperlessError = new Error("paperless.errors.unauthorized");
    const Page = Route.options.component!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "Paperless" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in Paperless" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invoice.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
  });
  it("retains Paperless tools for allowed users when the instance is configured but disabled", () => {
    mocks.paperlessConfigured = true;
    const Page = Route.options.component!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Paperless" }));
    expect(screen.getByRole("link", { name: "Open in Paperless" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import from Paperless" })).toBeDisabled();
  });
  it("filters actual document rows by known Paperless linkage", () => {
    mocks.paperlessEnabled = true;
    const Page = Route.options.component!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Invoice.pdf" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paperless" }));
    fireEvent.change(screen.getByLabelText("Paperless status"), { target: { value: "absent" } });
    expect(screen.queryByRole("button", { name: "Invoice.pdf" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Paperless status"), { target: { value: "present" } });
    expect(screen.getByRole("button", { name: "Invoice.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Paperless" })).toHaveAttribute(
      "href",
      "https://paperless.example.test/documents/8/details",
    );
  });

  it("counts only visible selected documents for manual transfer", () => {
    mocks.paperlessEnabled = true;
    const Page = Route.options.component!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Paperless" }));
    fireEvent.click(screen.getByLabelText("Select Invoice.pdf"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Paperless status"), { target: { value: "absent" } });
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transfer to Paperless" })).toBeDisabled();
  });

  it("initially hides Paperless tools, document selection and source details", () => {
    mocks.paperlessEnabled = true;
    const Page = Route.options.component!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>,
    );
    const toggle = screen.getByRole("button", { name: "Paperless" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", { name: "Paperless status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in Paperless" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Select Invoice.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Paperless" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select Invoice.pdf"));
    fireEvent.change(screen.getByLabelText("Paperless status"), { target: { value: "absent" } });
    expect(screen.queryByRole("button", { name: "Invoice.pdf" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Invoice.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Paperless status")).toHaveValue("all");
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Invoice.pdf")).not.toBeChecked();
  });

  it("does not offer Paperless mode when the integration is disabled", async () => {
    await openMenu();
    expect(screen.queryByRole("button", { name: "Paperless" })).not.toBeInTheDocument();
  });

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
