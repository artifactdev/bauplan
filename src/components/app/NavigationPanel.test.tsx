import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { getNavigation, saveNavigation } from "@/lib/data.functions";
import { DEFAULT_NAVIGATION, navigationSchema } from "@/lib/navigation";
import { NavigationPanel } from "./NavigationPanel";

vi.mock("@/lib/data.functions", () => ({ getNavigation: vi.fn(), saveNavigation: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  vi.mocked(getNavigation).mockResolvedValue(DEFAULT_NAVIGATION);
  vi.mocked(saveNavigation).mockImplementation(async (options) =>
    navigationSchema.parse(options?.data),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NavigationPanel userId="alice" />
    </QueryClientProvider>,
  );
  return client;
}

it("reorders and hides entries, saving only on explicit request and restoring defaults", async () => {
  const client = mount();
  await screen.findByRole("checkbox", { name: "Overview" });
  fireEvent.click(screen.getByRole("button", { name: "Move Budget up" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Documents" }));
  expect(saveNavigation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save navigation" }));
  await waitFor(() =>
    expect(client.getQueryData(["navigation", "alice"])).toEqual({
      order: ["/budget", "/", ...DEFAULT_NAVIGATION.order.slice(2)],
      hidden: ["/dokumente"],
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Restore default layout" }));
  expect(screen.getByRole("checkbox", { name: "Documents" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save navigation" }));
  await waitFor(() =>
    expect(saveNavigation).toHaveBeenLastCalledWith({ data: DEFAULT_NAVIGATION }),
  );
});

it("retains the draft and confirmed navigation after a failed save", async () => {
  vi.mocked(saveNavigation).mockRejectedValueOnce(new Error("Save failed"));
  const client = mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Overview" }));
  fireEvent.click(screen.getByRole("button", { name: "Save navigation" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save navigation" })).toBeEnabled(),
  );
  expect(screen.getByRole("checkbox", { name: "Overview" })).not.toBeChecked();
  expect(client.getQueryData(["navigation", "alice"])).toEqual(DEFAULT_NAVIGATION);
});

function mockRowPositions() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const row = this.closest("li");
    const index = row ? Array.from(row.parentElement!.children).indexOf(row) : 0;
    return {
      x: 0,
      y: index * 64,
      top: index * 64,
      bottom: index * 64 + 56,
      left: 0,
      right: 400,
      width: 400,
      height: 56,
      toJSON: () => ({}),
    };
  });
}

it("reorders with the keyboard drag handle and saves the same order while preserving hidden entries", async () => {
  vi.mocked(getNavigation).mockResolvedValue({ ...DEFAULT_NAVIGATION, hidden: ["/budget"] });
  mockRowPositions();
  mount();
  const handle = await screen.findByRole("button", { name: "Drag Overview to reorder" });
  handle.focus();
  fireEvent.keyDown(handle, { key: " ", code: "Space" });
  await waitFor(() => expect(handle).toHaveAttribute("aria-pressed", "true"));
  fireEvent.keyDown(handle, { key: "ArrowDown", code: "ArrowDown" });
  await waitFor(() => expect(screen.getByText("Position 2 of 10.")).toBeInTheDocument());
  fireEvent.keyDown(handle, { key: " ", code: "Space" });
  await waitFor(() => expect(screen.getAllByRole("checkbox")[0]).toHaveAccessibleName("Budget"));
  expect(saveNavigation).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox", { name: "Budget" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save navigation" }));
  await waitFor(() =>
    expect(saveNavigation).toHaveBeenCalledWith({
      data: { order: ["/budget", "/", ...DEFAULT_NAVIGATION.order.slice(2)], hidden: ["/budget"] },
    }),
  );
});

it("cancels dragging without changing the order or creating an unsaved draft", async () => {
  mockRowPositions();
  mount();
  const handle = await screen.findByRole("button", { name: "Drag Overview to reorder" });
  handle.focus();
  fireEvent.keyDown(handle, { key: " ", code: "Space" });
  await waitFor(() => expect(handle).toHaveAttribute("aria-pressed", "true"));
  fireEvent.keyDown(handle, { key: "ArrowDown", code: "ArrowDown" });
  await screen.findByText("Position 2 of 10.");
  fireEvent.keyDown(handle, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(handle).not.toHaveAttribute("aria-pressed", "true"));
  expect(screen.getAllByRole("checkbox")[0]).toHaveAccessibleName("Overview");
  expect(screen.getByRole("button", { name: "Save navigation" })).toBeDisabled();
  expect(saveNavigation).not.toHaveBeenCalled();
});
