import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { extractFromText } from "@/lib/ocr-parse";
import { analyzeDocument } from "@/lib/ocr.functions";
import { AssignDialog } from "./AssignDialog";

const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      trades: [],
      cost_items: [],
      budget_pots: [],
      contacts: [],
      offers: [],
      documents: [{ id: "doc-1", name: "Quote.pdf" }],
    },
  }),
  useMutations: () => ({
    create: { mutateAsync: mutations.create },
    update: { mutateAsync: mutations.update },
  }),
}));
vi.mock("@/lib/ocr.functions", () => ({ analyzeDocument: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("filing a recognized offer", () => {
  it("reviews and saves offer validity alongside the amount and document date", async () => {
    await i18n.changeLanguage("en");
    const extraction = extractFromText(
      "Dachdeckerei Beispiel GmbH\nAngebot Nr. 12\nAngebotsdatum: 27.10.2026\nAngebotssumme 30.392,00 EUR\nGültig bis 10.11.2026",
    );
    vi.mocked(analyzeDocument).mockResolvedValue({
      result: extraction,
      error: null,
      warnings: [],
    });
    mutations.create.mockResolvedValue({ id: "offer-1" });
    mutations.update.mockResolvedValue({ ok: true });

    render(<AssignDialog documentId="doc-1" onClose={() => {}} />);
    const validity = await screen.findByLabelText("Valid until");
    expect(validity).toHaveValue("2026-11-10");
    fireEvent.change(validity, { target: { value: "2026-11-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(mutations.create).toHaveBeenCalledWith({
        table: "offers",
        row: expect.objectContaining({
          document_id: "doc-1",
          amount: 30392,
          offer_date: "2026-10-27",
          valid_until: "2026-11-12",
          status: "received",
        }),
      }),
    );
  });

  it("files a recognized invoice as an open expense without a separate invoice target", async () => {
    await i18n.changeLanguage("en");
    vi.mocked(analyzeDocument).mockResolvedValue({
      result: {
        ...extractFromText("Rechnung"),
        doc_type: "rechnung",
        vendor: "Roofing",
        title: "Roof invoice",
        amount: 1000,
        date: "2026-01-01",
        due_date: "2026-01-15",
        contact_id: "contact",
      },
      error: null,
      warnings: [],
    });
    mutations.create.mockResolvedValue({ id: "expense-1" });
    mutations.update.mockResolvedValue({ ok: true });
    render(<AssignDialog documentId="doc-1" onClose={() => {}} />);
    expect(await screen.findByLabelText("Payable by")).toHaveValue("2026-01-15");
    expect(screen.queryByRole("radio", { name: "Contractor invoice" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(mutations.create).toHaveBeenCalledWith({
        table: "expenses",
        row: expect.objectContaining({
          document_id: "doc-1",
          contact_id: "contact",
          due_date: "2026-01-15",
          status: "offen",
          amount: 1000,
          payment_date: null,
        }),
      }),
    );
  });
});
