import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { extractFromText } from "@/lib/ocr-parse";
import type { Expense, Offer } from "@/lib/schema";
import { Route } from "./ausgaben";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  analyze: vi.fn(),
  expenses: [] as Expense[],
  offers: [] as Offer[],
}));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      expenses: mocks.expenses,
      offers: mocks.offers,
      budget_pots: [],
      trades: [],
      cost_items: [],
      contacts: [],
      documents: [],
    },
  }),
  useMutations: () => ({
    create: { mutateAsync: mocks.create },
    update: { mutateAsync: mocks.update },
    remove: { mutateAsync: vi.fn() },
    upload: { mutateAsync: mocks.upload },
  }),
}));
vi.mock("@/lib/ocr.functions", () => ({
  analyzeDocument: (...args: unknown[]) => mocks.analyze(...args),
}));
vi.mock("@/components/app/DocumentScanner", () => ({
  DocumentScanner: () => null,
}));

beforeEach(async () => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.expenses.length = 0;
  mocks.offers.length = 0;
  await i18n.changeLanguage("en");
  mocks.create.mockResolvedValue({ id: "expense-1" });
  mocks.upload.mockResolvedValue({ id: "document-1" });
});
afterEach(cleanup);

function openExpenseForm() {
  const Page = Route.options.component;
  if (!Page) throw new Error("Missing expenses page component");
  render(<Page />);
  expect(screen.queryByRole("button", { name: "Manual" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Upload receipt" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create expense" }));
}

describe("unified expense creation", () => {
  it("links a partial invoice to a quote and prefills assignments without replacing its amount", async () => {
    mocks.offers.push({
      id: "offer-1",
      contractor: "Roofing",
      title: "Full roof",
      amount: 9000,
      trade_id: null,
      cost_item_id: null,
      contact_id: null,
      document_id: null,
      requested_date: null,
      offer_date: null,
      status: "accepted",
      notes: null,
    });
    openExpenseForm();
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "First installment" },
    });
    fireEvent.change(screen.getByLabelText(/gross amount/i), { target: { value: "250" } });
    fireEvent.keyDown(screen.getByLabelText("Related quote (optional)"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Roofing – Full roof" }));
    expect(screen.getByLabelText(/gross amount/i)).toHaveValue(250);
    expect(screen.getByLabelText("Shop / company")).toHaveValue("Roofing");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        table: "expenses",
        row: expect.objectContaining({
          title: "First installment",
          amount: "250",
          offer_id: "offer-1",
          vendor: "Roofing",
        }),
      }),
    );
  });

  it("creates an expense without requiring a receipt", async () => {
    openExpenseForm();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Disposal" } });
    fireEvent.change(screen.getByLabelText(/gross amount/i), { target: { value: "45.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        table: "expenses",
        row: expect.objectContaining({ title: "Disposal", amount: "45.50", status: "bezahlt" }),
      }),
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("optionally uploads a receipt and saves reviewed prefilled values in the same form", async () => {
    mocks.analyze.mockResolvedValue({
      result: {
        ...extractFromText("Kassenbon"),
        title: "Hardware",
        vendor: "Hardware store",
        amount: 123.45,
        date: "2026-10-25",
      },
      error: null,
      warnings: [],
    });
    openExpenseForm();
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    const file = new File(["receipt"], "receipt.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"][accept="application/pdf,image/*"]');
    if (!input) throw new Error("Missing receipt upload input");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText(/gross amount/i)).toHaveValue(123.45));
    expect(screen.getByLabelText("Description")).toHaveValue("Hardware");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-25");
    fireEvent.change(screen.getByLabelText(/gross amount/i), { target: { value: "125" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        table: "expenses",
        row: expect.objectContaining({
          title: "Hardware",
          vendor: "Hardware store",
          amount: "125",
          expense_date: "2026-10-25",
          document_id: "document-1",
        }),
      }),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("creates an open expense from an invoice with its recognized due date and contact", async () => {
    mocks.analyze.mockResolvedValue({
      result: {
        ...extractFromText("Rechnung"),
        doc_type: "rechnung",
        title: "Roof invoice",
        amount: 1000,
        date: "2026-01-01",
        due_date: "2026-01-15",
        contact_id: "roofer",
      },
      error: null,
      warnings: [],
    });
    openExpenseForm();
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    const input = document.querySelector('input[type="file"][accept="application/pdf,image/*"]');
    if (!input) throw new Error("Missing receipt upload input");
    fireEvent.change(input, {
      target: { files: [new File(["invoice"], "invoice.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect(screen.getByLabelText("Payable by")).toHaveValue("2026-01-15"));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        table: "expenses",
        row: expect.objectContaining({
          title: "Roof invoice",
          amount: 1000,
          due_date: "2026-01-15",
          contact_id: "roofer",
          status: "offen",
        }),
      }),
    );
  });

  it("uploads a document while editing without resetting an already paid expense to open", async () => {
    mocks.expenses.push({
      id: "existing",
      title: "Old expense",
      vendor: null,
      amount: 50,
      status: "bezahlt",
      expense_date: "2026-01-01",
      category: "Material",
      trade_id: null,
      cost_item_id: null,
      document_id: null,
      notes: null,
    });
    const Page = Route.options.component;
    if (!Page) throw new Error("Missing expenses page component");
    render(<Page />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    expect(screen.getByRole("button", { name: "Add document" })).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveValue("Old expense");
    mocks.analyze.mockResolvedValue({
      result: {
        ...extractFromText("Rechnung"),
        doc_type: "rechnung",
        title: "Reviewed invoice",
        amount: 50,
      },
      error: null,
      warnings: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    const input = document.querySelector('input[type="file"][accept="application/pdf,image/*"]');
    if (!input) throw new Error("Missing receipt upload input");
    fireEvent.change(input, {
      target: { files: [new File(["invoice"], "invoice.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Description")).toHaveValue("Reviewed invoice"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        table: "expenses",
        id: "existing",
        patch: expect.objectContaining({ status: "bezahlt", document_id: "document-1" }),
      }),
    );
  });
});
