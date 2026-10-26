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
afterEach(cleanup);

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
