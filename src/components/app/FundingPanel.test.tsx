import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { FundingEntry } from "@/lib/schema";
import { FundingPanel } from "./FundingPanel";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  funding: [] as FundingEntry[],
}));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      funding_entries: mocks.funding,
      budget_pots: [{ id: "grandma", name: "Oma", deducts_from_budget: true }],
      expenses: [],
      invoices: [],
    },
  }),
  useMutations: () => ({
    create: { mutateAsync: mocks.create },
    update: { mutateAsync: mocks.update },
    remove: { mutate: mocks.remove },
  }),
}));
vi.mock("./ScanBar", () => ({ ScanBar: () => null }));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  mocks.funding.length = 0;
  mocks.create.mockResolvedValue({ id: "new" });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("incoming project funds", () => {
  it("creates a received payment with amount, source and date", async () => {
    render(<FundingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Record incoming funds" }));
    fireEvent.keyDown(screen.getByLabelText("Origin / payment source"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Oma" }));
    fireEvent.change(screen.getByLabelText("Amount received (€)"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Date received"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        table: "funding_entries",
        row: expect.objectContaining({
          budget_pot_id: "grandma",
          amount: "10000",
          received_date: "2026-01-01",
        }),
      }),
    );
  });

  it("creates a new budget-counting source inline before recording funds", async () => {
    render(<FundingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Record incoming funds" }));
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByPlaceholderText("New payment source"), {
      target: { value: "Opa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        table: "budget_pots",
        row: { name: "Opa", deducts_from_budget: true },
      }),
    );
    fireEvent.change(screen.getByLabelText("Amount received (€)"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        table: "funding_entries",
        row: expect.objectContaining({ budget_pot_id: "new", amount: "500" }),
      }),
    );
  });

  it("edits a saved entry rather than adding the received amount again", async () => {
    mocks.funding.push({
      id: "entry",
      budget_pot_id: "grandma",
      amount: 10000,
      received_date: "2026-01-01",
      notes: null,
    });
    render(<FundingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit incoming funds" }));
    fireEvent.change(screen.getByLabelText("Amount received (€)"), { target: { value: "9000" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        table: "funding_entries",
        id: "entry",
        patch: expect.objectContaining({ amount: "9000" }),
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not save zero or negative incoming funds", async () => {
    render(<FundingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Record incoming funds" }));
    fireEvent.keyDown(screen.getByLabelText("Origin / payment source"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Oma" }));
    fireEvent.change(screen.getByLabelText("Amount received (€)"), { target: { value: "-100" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
