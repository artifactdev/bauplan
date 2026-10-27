import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { updateRow } from "@/lib/data.functions";
import { ProjectDialog } from "./ProjectDialog";

vi.mock("./ScanBar", () => ({ ScanBar: () => null }));
vi.mock("@/lib/data.functions", () => ({
  createRow: vi.fn(),
  deleteRow: vi.fn(),
  getWorkspace: vi.fn(),
  updateRow: vi.fn(),
  uploadDocument: vi.fn(),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("de");
});
afterEach(cleanup);

it("prefills the project and saves edits through the shared mutation, refreshing workspace data", async () => {
  vi.mocked(updateRow).mockResolvedValue({ ok: true });
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ProjectDialog
        open
        onOpenChange={close}
        project={{
          id: "project-1",
          name: "Renovierung",
          address: "Alte Straße 1",
          total_budget: 100000,
          start_date: "2026-11-01",
          end_date: "2027-08-31",
        }}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("Projektname")).toHaveValue("Renovierung");
  expect(screen.getByLabelText("Initiales Bankbudget (€)")).toHaveValue(100000);
  fireEvent.change(screen.getByLabelText("Projektname"), { target: { value: "Sanierung" } });
  fireEvent.change(screen.getByLabelText("Adresse"), { target: { value: "Neue Straße 2" } });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(updateRow).toHaveBeenCalledWith({
    data: {
      table: "projects",
      id: "project-1",
      patch: expect.objectContaining({
        name: "Sanierung",
        address: "Neue Straße 2",
        total_budget: 100000,
        start_date: "2026-11-01",
        end_date: "2027-08-31",
      }),
    },
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ws"] });
});
