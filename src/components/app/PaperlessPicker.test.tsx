import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { PaperlessPicker } from "./PaperlessPicker";

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

describe("personal Paperless picker", () => {
  it("requires sharing acknowledgement and scopes search results to the current account and instance", async () => {
    await i18n.changeLanguage("en");
    const client = new QueryClient();
    const search = vi
      .fn()
      .mockResolvedValue({ count: 1, results: [{ id: 8, title: "Invoice" }], hasNext: false });
    const choose = vi.fn().mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={client}>
        <PaperlessPicker
          userId="member-a"
          instanceKey="instance-a"
          metadata={{ tags: [], documentTypes: [], correspondents: [] }}
          onClose={() => {}}
          search={search}
          preview={vi.fn()}
          choose={choose}
        />
      </QueryClientProvider>,
    );
    const button = await screen.findByRole("button", { name: "Import and review" });
    expect(button).toBeDisabled();
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((entry) => entry.queryKey),
    ).toEqual([["paperless", "member-a", "instance-a", "search", { query: "", page: 1 }]]);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button);
    await waitFor(() => expect(choose).toHaveBeenCalledWith(8, expect.anything()));
  });

  it("shows failed searches as errors, not an empty archive", async () => {
    await i18n.changeLanguage("en");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PaperlessPicker
          userId="member-a"
          instanceKey="instance-a"
          metadata={{ tags: [], documentTypes: [], correspondents: [] }}
          onClose={() => {}}
          search={vi.fn().mockRejectedValue(new Error("paperless.errors.forbidden"))}
          preview={vi.fn()}
          choose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your Paperless account does not have permission",
    );
    expect(screen.queryByText("No matching documents")).not.toBeInTheDocument();
  });
});
