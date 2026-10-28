import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { PaperlessAutoImportSettings } from "./PaperlessAutoImportSettings";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  tags: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/data.functions", () => ({
  getPaperlessAutoImport: mocks.read,
  getPaperlessImportTags: mocks.tags,
  savePaperlessAutoImport: mocks.save,
}));
vi.mock("@/lib/offline-store", () => ({
  getOfflineAccount: () => ({ id: "member" }),
}));

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("en");
  mocks.read.mockResolvedValue(null);
  mocks.tags.mockResolvedValue([{ id: 11, name: "Bauplan" }]);
  mocks.save.mockResolvedValue(null);
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

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PaperlessAutoImportSettings instanceId="instance" />
    </QueryClientProvider>,
  );
}

describe("automatic Paperless import settings", () => {
  it("defaults to disabled and requires sharing consent before enabling the chosen tag", async () => {
    show();
    const tag = await screen.findByLabelText("Tag for automatic import");
    await screen.findByRole("option", { name: "Bauplan" });
    expect(tag).toHaveValue("");
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(tag, { target: { value: "11" } });
    const save = screen.getByRole("button", { name: "Save import rule" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        data: { tagId: 11, confirmSharing: true },
      }),
    );
  });

  it("shows stored selection, last result and background errors, and allows disabling without consent", async () => {
    mocks.read.mockResolvedValue({
      tagId: 11,
      lastRun: "2026-10-28T12:00:00Z",
      nextRun: "2026-10-28T12:05:00Z",
      imported: 2,
      skipped: 3,
      failed: 1,
      error: "forbidden",
    });
    show();
    const tag = await screen.findByLabelText("Tag for automatic import");
    expect(tag).toHaveValue("11");
    expect(screen.getByText("Last pass: 2 imported, 3 skipped, 1 failed.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(tag, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save import rule" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        data: { tagId: null, confirmSharing: false },
      }),
    );
  });

  it("retains the saved tag when metadata is unavailable and still permits disabling", async () => {
    mocks.read.mockResolvedValue({
      tagId: 11,
      lastRun: null,
      nextRun: "2026-10-28T12:05:00Z",
      imported: 0,
      skipped: 0,
      failed: 0,
      error: null,
    });
    mocks.tags.mockRejectedValue(new Error("paperless.errors.forbidden"));
    show();
    await screen.findByRole("alert");
    const tag = await screen.findByLabelText("Tag for automatic import");
    expect(tag).toHaveValue("11");
    expect(screen.getByRole("button", { name: "Save import rule" })).toBeDisabled();
    fireEvent.change(tag, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save import rule" })).toBeEnabled();
  });

  it("surfaces failed saves without clearing the selected tag", async () => {
    mocks.save.mockRejectedValue(new Error("paperless.errors.invalid_metadata"));
    show();
    const tag = await screen.findByLabelText("Tag for automatic import");
    await screen.findByRole("option", { name: "Bauplan" });
    fireEvent.change(tag, { target: { value: "11" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save import rule" }));
    await screen.findByRole("alert");
    expect(tag).toHaveValue("11");
  });
});
