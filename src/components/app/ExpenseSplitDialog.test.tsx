import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { Expense } from "@/lib/schema";
import { ExpenseSplitDialog } from "./ExpenseSplitDialog";

const mutations = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    ws: {
      budget_pots: [
        { id: "bank", name: "Bank", deducts_from_budget: true, notes: null },
        { id: "jerry", name: "Jerry", deducts_from_budget: false, notes: null },
      ],
    },
  }),
  useMutations: () => ({
    create: { mutateAsync: mutations.create },
    update: { mutateAsync: mutations.update },
    remove: { mutateAsync: mutations.remove },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const expense = {
  id: "expense-1",
  created_at: "2026-11-01",
  title: "Baumarkt",
  amount: 300,
  status: "eingereicht",
  budget_pot_id: "jerry",
} as Expense;

beforeEach(() => i18n.changeLanguage("en"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("creates the reimbursed part on the bank source and reduces the original", async () => {
  mutations.create.mockResolvedValue({ id: "new-expense" });
  mutations.update.mockResolvedValue({});
  const onClose = vi.fn();
  render(<ExpenseSplitDialog expense={expense} onClose={onClose} />);
  const dialog = within(screen.getByRole("dialog"));
  const submit = dialog.getByRole("button", { name: "Split" });
  expect(submit).toBeDisabled();

  fireEvent.change(dialog.getByLabelText(/Partial amount/), { target: { value: "120" } });
  expect(dialog.getByText(/Partial amount: .*Reimbursed · Bank/)).toBeInTheDocument();
  expect(dialog.getByText(/Remainder: .*Submitted · Jerry/)).toBeInTheDocument();
  fireEvent.click(submit);

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mutations.create).toHaveBeenCalledWith({
    table: "expenses",
    row: expect.objectContaining({
      title: "Baumarkt (Reimbursed)",
      amount: 120,
      status: "erstattet",
      budget_pot_id: "bank",
    }),
  });
  expect(mutations.update).toHaveBeenCalledWith({
    table: "expenses",
    id: "expense-1",
    patch: { amount: 180 },
  });
});

it("removes the new part again when the original cannot be reduced", async () => {
  mutations.create.mockResolvedValue({ id: "new-expense" });
  mutations.update.mockRejectedValue(new Error("fail"));
  mutations.remove.mockResolvedValue({});
  const onClose = vi.fn();
  render(<ExpenseSplitDialog expense={expense} onClose={onClose} />);
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText(/Partial amount/), { target: { value: "120" } });
  fireEvent.click(dialog.getByRole("button", { name: "Split" }));

  await waitFor(() =>
    expect(mutations.remove).toHaveBeenCalledWith({ table: "expenses", id: "new-expense" }),
  );
  expect(onClose).not.toHaveBeenCalled();
});
