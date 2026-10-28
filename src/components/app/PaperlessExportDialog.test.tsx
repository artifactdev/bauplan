import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { Doc } from "@/lib/schema";
import { PaperlessExportDialog } from "./PaperlessExportDialog";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function document(id: string): Doc {
  return {
    id,
    name: `${id}.pdf`,
    created_at: "2026-10-28",
    category: "Sonstiges",
    tags: null,
    description: null,
    storage_path: `${id}.pdf`,
    mime_type: "application/pdf",
    size: 12,
    trade_id: null,
    task_id: null,
    cost_item_id: null,
  };
}

describe("manual batch archiving", () => {
  it("requires explicit submission and never substitutes upload time for a confirmed date", async () => {
    await i18n.changeLanguage("en");
    const submit = vi.fn().mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PaperlessExportDialog
          documents={[document("one"), document("two")]}
          metadata={{
            tags: [{ id: 3, name: "Renovation" }],
            documentTypes: [{ id: 2, name: "Invoice" }],
            correspondents: [],
          }}
          destination="https://paperless.example.test"
          account="member@example.test"
          onClose={() => {}}
          onSubmit={submit}
        />
      </QueryClientProvider>,
    );
    expect(submit).not.toHaveBeenCalled();
    const dates = screen.getAllByLabelText("Confirmed document date (optional)");
    expect(dates[0]).toHaveValue("");
    expect(dates[1]).toHaveValue("");
    fireEvent.change(dates[0]!, { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getAllByLabelText("Document type")[0]!, { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Renovation"));
    fireEvent.click(screen.getByRole("button", { name: "Start transfer" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith([
        { documentId: "one", title: "one.pdf", created: "2026-10-12", documentType: 2, tags: [3] },
        { documentId: "two", title: "two.pdf", tags: [3] },
      ]),
    );
  });
});
