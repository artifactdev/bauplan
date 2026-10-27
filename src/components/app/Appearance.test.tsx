import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import { getAppearance, saveAppearance } from "@/lib/data.functions";
import { APPEARANCE_CACHE_KEY, appearanceSchema, type Appearance } from "@/lib/appearance";
import { AccountAppearance, AppearanceProvider, useAppearance } from "./AppearanceProvider";
import { AppearancePanel } from "./AppearanceControls";

vi.mock("@/lib/data.functions", () => ({ getAppearance: vi.fn(), saveAppearance: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const BLUE = "#295cc5";
const GREEN = "#176b50";
const VIOLET = "#6d28d9";
let dark = false;
let mediaListeners = new Set<() => void>();

function ResolvedMode() {
  return <output data-testid="resolved">{useAppearance().resolvedMode}</output>;
}

function chooseColor(color: string) {
  fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: color } });
}

function mount(userId = "alice") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function App({ id }: { id: string | null }) {
    return (
      <QueryClientProvider client={client}>
        <AppearanceProvider>
          <ResolvedMode />
          {id && (
            <AccountAppearance key={id} userId={id}>
              <AppearancePanel />
            </AccountAppearance>
          )}
        </AppearanceProvider>
      </QueryClientProvider>
    );
  }
  const rendered = render(<App id={userId} />);
  return {
    ...rendered,
    client,
    switchAccount: (id: string | null) => rendered.rerender(<App id={id} />),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  dark = false;
  mediaListeners = new Set();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    get matches() {
      return dark;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      mediaListeners.add(listener as () => void);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      mediaListeners.delete(listener as () => void);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  await i18n.changeLanguage("en");
  vi.mocked(getAppearance).mockResolvedValue({ primaryColor: BLUE, mode: "system" });
  vi.mocked(saveAppearance).mockImplementation(async (options) =>
    appearanceSchema.parse(options?.data),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Appearance account controller and settings", () => {
  it("loads the account color before controls, overriding another browser appearance", async () => {
    localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify({ palette: "violet", mode: "dark" }));
    mount();
    expect(screen.queryByLabelText("Primary color")).not.toBeInTheDocument();
    expect(await screen.findByText(BLUE.toUpperCase())).toBeInTheDocument();
    expect(document.documentElement.dataset["theme"]).toBe("custom");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });
  it("saves a custom color immediately and caches only successful responses", async () => {
    let complete!: (value: Appearance) => void;
    vi.mocked(saveAppearance).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    mount();
    await screen.findByLabelText("Primary color");
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveClass("dark");
    await waitFor(() =>
      expect(saveAppearance).toHaveBeenCalledWith({ data: { primaryColor: BLUE, mode: "dark" } }),
    );
    chooseColor(GREEN);
    expect(JSON.parse(localStorage.getItem(APPEARANCE_CACHE_KEY)!)).toEqual({
      primaryColor: BLUE,
      mode: "system",
    });
    await act(async () => complete({ primaryColor: BLUE, mode: "dark" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Appearance" })).toBeEmptyDOMElement(),
    );
    await waitFor(() =>
      expect(saveAppearance).toHaveBeenLastCalledWith({
        data: { primaryColor: GREEN, mode: "dark" },
      }),
    );
  });
  it("reacts to OS changes only in System and cleans up listeners", async () => {
    const app = mount();
    await screen.findByRole("radio", { name: "System" });
    act(() => {
      dark = true;
      mediaListeners.forEach((listener) => listener());
    });
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(saveAppearance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Appearance" })).toBeEmptyDOMElement(),
    );
    act(() => {
      dark = false;
      mediaListeners.forEach((listener) => listener());
      dark = true;
      mediaListeners.forEach((listener) => listener());
    });
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    app.unmount();
    expect(mediaListeners.size).toBe(0);
  });
  it("rolls back and reports failed saves", async () => {
    vi.mocked(saveAppearance).mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    await screen.findByLabelText("Primary color");
    chooseColor(VIOLET);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("could not be saved")),
    );
    expect(screen.getByText(BLUE.toUpperCase())).toBeInTheDocument();
    expect(document.documentElement.dataset["theme"]).toBe("custom");
  });
  it("offers retry instead of displaying an unsynchronized workspace", async () => {
    vi.mocked(getAppearance).mockRejectedValueOnce(new Error("offline"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(BLUE.toUpperCase())).toBeInTheDocument();
  });
  it("refreshes on focus without overriding a save in flight", async () => {
    let complete!: (value: Appearance) => void;
    mount();
    await screen.findByText(BLUE.toUpperCase());
    vi.mocked(getAppearance).mockResolvedValue({ primaryColor: GREEN, mode: "light" });
    fireEvent.focus(window);
    expect(await screen.findByText(GREEN.toUpperCase())).toBeInTheDocument();
    vi.mocked(saveAppearance).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await waitFor(() => expect(saveAppearance).toHaveBeenCalled());
    const calls = vi.mocked(getAppearance).mock.calls.length;
    fireEvent.focus(window);
    expect(getAppearance).toHaveBeenCalledTimes(calls);
    await act(async () => complete({ primaryColor: GREEN, mode: "dark" }));
    expect(document.documentElement).toHaveClass("dark");
  });
  it("does not apply a previous account's late save after switching or signing out", async () => {
    let complete!: (value: Appearance) => void;
    const app = mount();
    fireEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    vi.mocked(getAppearance).mockResolvedValue({ primaryColor: VIOLET, mode: "light" });
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Appearance" })).toBeEmptyDOMElement(),
    );
    vi.mocked(saveAppearance).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    chooseColor(GREEN);
    await waitFor(() => expect(saveAppearance).toHaveBeenCalledTimes(2));
    app.switchAccount("bob");
    expect(await screen.findByText(VIOLET.toUpperCase())).toBeInTheDocument();
    await act(async () => complete({ primaryColor: GREEN, mode: "dark" }));
    expect(document.documentElement.dataset["theme"]).toBe("custom");
    expect(document.documentElement).not.toHaveClass("dark");
    app.switchAccount(null);
    expect(app.client.getQueryCache().findAll({ queryKey: ["appearance"] })).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(APPEARANCE_CACHE_KEY)!)).toEqual({
      primaryColor: VIOLET,
      mode: "light",
    });
  });
  it("continues account persistence when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount();
    fireEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    await waitFor(() =>
      expect(saveAppearance).toHaveBeenCalledWith({ data: { primaryColor: BLUE, mode: "dark" } }),
    );
    expect(warning).toHaveBeenCalled();
  });
  it("coalesces rapid color and mode changes without parallel writes", async () => {
    let complete!: (value: Appearance) => void;
    vi.mocked(saveAppearance).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    mount();
    const input = await screen.findByLabelText("Primary color");
    input.focus();
    chooseColor(GREEN);
    await waitFor(() => expect(saveAppearance).toHaveBeenCalledTimes(1));
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    chooseColor(VIOLET);
    expect(saveAppearance).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset["theme"]).toBe("custom");
    await act(async () => complete({ primaryColor: GREEN, mode: "system" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Appearance" })).toBeEmptyDOMElement(),
    );
    expect(saveAppearance).toHaveBeenCalledTimes(2);
    expect(saveAppearance).toHaveBeenLastCalledWith({
      data: { primaryColor: VIOLET, mode: "dark" },
    });
    expect(JSON.parse(localStorage.getItem(APPEARANCE_CACHE_KEY)!)).toEqual({
      primaryColor: VIOLET,
      mode: "dark",
    });
  });
  it("restores the latest confirmed save when a queued write fails", async () => {
    let complete!: (value: Appearance) => void;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(saveAppearance)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    mount();
    await screen.findByLabelText("Primary color");
    chooseColor(GREEN);
    await waitFor(() => expect(saveAppearance).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await act(async () => complete({ primaryColor: GREEN, mode: "system" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText(GREEN.toUpperCase())).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });
});
