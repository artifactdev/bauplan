import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOcrSettings,
  resetOcrSettings,
  saveOcrSettings,
  testOcrSettings,
} from "@/lib/data.functions";
import i18n from "@/i18n";
import { OcrSettingsPanel } from "./OcrSettingsPanel";

vi.mock("@/lib/data.functions", () => ({
  getOcrSettings: vi.fn(),
  resetOcrSettings: vi.fn(),
  saveOcrSettings: vi.fn(),
  testOcrSettings: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const initial = {
  enabled: true,
  provider: "tesseract" as const,
  baseUrl: "http://ocr:8000",
  language: "de+en" as const,
  hasApiKey: true,
  source: "saved" as const,
};

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
  vi.mocked(testOcrSettings).mockResolvedValue({ data: { warnings: [] }, error: null });
  vi.mocked(saveOcrSettings).mockResolvedValue({ data: true, error: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OCR settings panel", () => {
  it("displays capabilities and unrestricted HTTP warnings without revealing the existing key", async () => {
    mount();
    expect(await screen.findByLabelText("Service base URL")).toHaveValue("http://ocr:8000");
    expect(screen.getByText(/There is no network allowlist or SSRF protection/)).toBeVisible();
    expect(screen.getByText(/HTTP is not encrypted/)).toBeVisible();
    expect(screen.getByText(/no table structure/)).toBeVisible();
    expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("OCR provider"), { target: { value: "docling" } });
    expect(screen.getByText(/Capabilities: text, page information, table structure/)).toBeVisible();
  });
  it("tests current draft without saving", async () => {
    mount();
    await screen.findByLabelText("Service base URL");
    fireEvent.change(screen.getByLabelText("Recognition language"), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: "Test document processing" }));
    expect(await screen.findByText(/synthetic test image was successfully read/)).toBeVisible();
    expect(testOcrSettings).toHaveBeenCalledWith({
      data: {
        settings: {
          enabled: true,
          provider: "tesseract",
          baseUrl: initial.baseUrl,
          language: "en",
        },
        secretAction: "keep",
      },
    });
    expect(saveOcrSettings).not.toHaveBeenCalled();
  });
  it("only sends a replacement key when explicitly requested and clears the input after save", async () => {
    mount();
    await screen.findByLabelText("Service base URL");
    fireEvent.change(screen.getByLabelText(/API key \(optional\)/), {
      target: { value: "replace" },
    });
    fireEvent.change(screen.getByLabelText("New API key"), {
      target: { value: "new-private-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save OCR settings" }));
    await waitFor(() =>
      expect(saveOcrSettings).toHaveBeenCalledWith({
        data: {
          settings: {
            enabled: true,
            provider: "tesseract",
            baseUrl: initial.baseUrl,
            language: "de+en",
          },
          secretAction: "replace",
          apiKey: "new-private-secret",
        },
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument());
  });
  it("provides recovery reset and localized German errors for invalid stored configuration", async () => {
    await i18n.changeLanguage("de");
    vi.mocked(getOcrSettings).mockResolvedValue({ data: null, error: "invalidSettings" });
    vi.mocked(resetOcrSettings).mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die OCR-Konfiguration ist ungültig",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Auf Umgebungskonfiguration zurücksetzen" }),
    );
    await waitFor(() => expect(resetOcrSettings).toHaveBeenCalled());
  });
});
