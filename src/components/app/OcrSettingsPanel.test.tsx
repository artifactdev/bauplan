import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteOcrModel,
  downloadOcrModel,
  getOcrModels,
  getOcrSettings,
  resetOcrSettings,
  saveOcrSettings,
  testOcrSettings,
} from "@/lib/data.functions";
import i18n from "@/i18n";
import { OcrSettingsPanel } from "./OcrSettingsPanel";

vi.mock("@/lib/data.functions", () => ({
  deleteOcrModel: vi.fn(),
  downloadOcrModel: vi.fn(),
  getOcrModels: vi.fn(),
  getOcrSettings: vi.fn(),
  resetOcrSettings: vi.fn(),
  saveOcrSettings: vi.fn(),
  testOcrSettings: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const initial = {
  enabled: true,
  language: "de+en" as const,
  legacySettings: false,
  source: "saved" as const,
};
const installed = [
  { language: "de" as const, installed: true, size: 1_300_000 },
  { language: "en" as const, installed: true, size: 2_900_000 },
];

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OcrSettingsPanel />
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  vi.mocked(getOcrSettings).mockResolvedValue({ data: initial, error: null });
  vi.mocked(getOcrModels).mockResolvedValue({ data: installed, error: null });
  vi.mocked(testOcrSettings).mockResolvedValue({ data: { warnings: [] }, error: null });
  vi.mocked(saveOcrSettings).mockResolvedValue({ data: true, error: null });
  vi.mocked(downloadOcrModel).mockResolvedValue({ data: true, error: null });
  vi.mocked(deleteOcrModel).mockResolvedValue({ data: true, error: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("local OCR settings panel", () => {
  it("explains local processing and displays installed model status and capabilities", async () => {
    mount();
    expect(await screen.findByText(/runs locally inside Bauplan with Tesseract.js/)).toBeVisible();
    expect(await screen.findByText(/German\s+installed/)).toBeVisible();
    expect(screen.getByText(/per-page text for PDFs/)).toBeVisible();
    expect(screen.getByText(/no table structure/)).toBeVisible();
    expect(
      screen.queryByLabelText(/Service base URL|API key|OCR provider/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Models are downloaded only when you choose Download/)).toBeVisible();
  });

  it("tests the current draft without saving or sending a user document", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Recognition language"), {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test document processing" }));
    expect(await screen.findByText(/synthetic test image was successfully read/)).toBeVisible();
    expect(testOcrSettings).toHaveBeenCalledWith({
      data: { settings: { enabled: true, language: "en" } },
    });
    expect(saveOcrSettings).not.toHaveBeenCalled();
  });

  it("downloads an explicitly selected language model", async () => {
    vi.mocked(getOcrModels).mockResolvedValue({
      data: [
        { language: "de", installed: false, size: null },
        { language: "en", installed: true, size: 2_900_000 },
      ],
      error: null,
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(downloadOcrModel).toHaveBeenCalledWith({ data: { language: "de" } }),
    );
  });

  it("only offers installed languages and surfaces migration notice for old service settings", async () => {
    vi.mocked(getOcrSettings).mockResolvedValue({
      data: { ...initial, language: "de", legacySettings: true },
      error: null,
    });
    vi.mocked(getOcrModels).mockResolvedValue({
      data: [
        { language: "de", installed: true, size: 1_300_000 },
        { language: "en", installed: false, size: null },
      ],
      error: null,
    });
    mount();
    expect(await screen.findByText(/Previous service settings are no longer used/)).toBeVisible();
    const language = screen.getByLabelText("Recognition language") as HTMLSelectElement;
    expect(language.options[0]?.disabled).toBe(false);
    expect(language.options[1]?.disabled).toBe(true);
    expect(language.options[2]?.disabled).toBe(true);
  });

  it("provides a localized reset action when persisted settings are invalid", async () => {
    await i18n.changeLanguage("de");
    vi.mocked(getOcrSettings).mockResolvedValue({ data: null, error: "invalidSettings" });
    vi.mocked(resetOcrSettings).mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die OCR-Einstellungen sind ungültig",
    );
    fireEvent.click(screen.getByRole("button", { name: "OCR-Einstellungen zurücksetzen" }));
    await waitFor(() => expect(resetOcrSettings).toHaveBeenCalled());
  });
});
