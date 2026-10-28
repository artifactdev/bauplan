import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import { resolveFileUrl } from "@/components/app/doc-open";
import { Route } from "./angebote";

const state = vi.hoisted(() => ({ missing: false }));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      offers: [
        {
          id: "offer",
          contractor: "Roofing",
          title: "New roof",
          amount: 1000,
          status: "received",
          document_id: "document",
          contact_id: null,
          cost_item_id: null,
          trade_id: null,
          requested_date: null,
          offer_date: "2026-10-28",
          valid_until: null,
          notes: null,
        },
      ],
      documents: state.missing
        ? []
        : [
            {
              id: "document",
              name: "Roof.pdf",
              storage_path: "roof.pdf",
              mime_type: "application/pdf",
            },
          ],
      contacts: [],
      trades: [],
      cost_items: [],
    },
  }),
  useMutations: () => ({ update: {}, remove: {} }),
}));
vi.mock("@/components/app/doc-open", () => ({ resolveFileUrl: vi.fn() }));
vi.mock("@/components/app/OfferDialog", () => ({ OfferDialog: () => null }));
vi.mock("@/components/app/quick-actions", () => ({ QuickTask: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/app/DocumentPreview", () => ({
  DocumentPreview: ({
    name,
    mime,
    url,
    onClose,
  }: {
    name: string;
    mime: string;
    url: string;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={name}>
      <span>{mime}</span>
      <span>{url}</span>
      <button onClick={onClose}>Close preview</button>
    </div>
  ),
}));
beforeEach(async () => {
  vi.clearAllMocks();
  state.missing = false;
  await i18n.changeLanguage("en");
  vi.mocked(resolveFileUrl).mockResolvedValue("/api/files/roof.pdf");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  const Page = Route.options.component;
  if (!Page) throw new Error("Missing offers page");
  render(<Page />);
}
describe("quote documents", () => {
  it.each(["cards", "table"])("opens the integrated viewer in %s view", async (view) => {
    const open = vi.spyOn(window, "open");
    mount();
    if (view === "table") fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    const preview = await screen.findByRole("dialog", { name: "Roof.pdf" });
    expect(preview).toHaveTextContent("application/pdf");
    expect(preview).toHaveTextContent("/api/files/roof.pdf");
    expect(resolveFileUrl).toHaveBeenCalledWith("roof.pdf");
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("reports a missing linked document", () => {
    state.missing = true;
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    expect(toast.error).toHaveBeenCalledWith("File not available");
    expect(resolveFileUrl).not.toHaveBeenCalled();
  });
  it("does not open a preview when resolving the file fails", async () => {
    vi.mocked(resolveFileUrl).mockResolvedValue(null);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await waitFor(() => expect(resolveFileUrl).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
