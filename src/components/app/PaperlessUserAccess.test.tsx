import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { PaperlessUserAccess } from "./PaperlessUserAccess";

const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/data.functions", () => ({
  getPaperlessUserAccess: mocks.list,
  setPaperlessUserAccess: mocks.save,
}));

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.save.mockResolvedValue({ ok: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function show(role = "member") {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PaperlessUserAccess userId="member" role={role} name="Alex" />
    </QueryClientProvider>,
  );
  return screen.getByRole("switch", { name: "Paperless access for Alex" });
}

describe("administrator-managed Paperless access", () => {
  it("starts members without access and grants only on explicit interaction", async () => {
    const control = show();
    await waitFor(() => expect(control).toBeEnabled());
    expect(control).not.toBeChecked();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(control);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        data: { userId: "member", enabled: true },
      }),
    );
  });
  it("keeps administrator access enabled and non-editable", async () => {
    const control = show("admin");
    await screen.findByText("Administrators always have access.");
    expect(control).toBeChecked();
    expect(control).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("never enables access controls for pending accounts", () => {
    expect(show("pending")).toBeDisabled();
  });
  it("requires confirmation before revoking access", async () => {
    mocks.list.mockResolvedValue(["member"]);
    const control = show();
    await waitFor(() => expect(control).toBeEnabled());
    expect(control).toBeChecked();
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(control);
    expect(mocks.save).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(control);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        data: { userId: "member", enabled: false },
      }),
    );
  });
  it("shows failed grant changes without claiming success", async () => {
    mocks.save.mockRejectedValue(new Error("paperless.errors.user_missing"));
    const control = show();
    await waitFor(() => expect(control).toBeEnabled());
    fireEvent.click(control);
    expect(await screen.findByRole("alert")).toHaveTextContent("The user no longer exists.");
    expect(control).not.toBeChecked();
  });
  it("disables changes and offers retry if access cannot be loaded", async () => {
    mocks.list.mockRejectedValue(new Error("Network unavailable"));
    const control = show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    expect(control).toBeDisabled();
    mocks.list.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(control).toBeEnabled());
  });
});
