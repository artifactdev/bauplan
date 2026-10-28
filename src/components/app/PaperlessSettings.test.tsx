import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { PaperlessSettings } from "./PaperlessSettings";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  save: vi.fn(),
  refetch: vi.fn(),
  enabled: true,
  connected: false,
  allowed: true,
}));
vi.mock("@/lib/data.functions", () => ({
  connectPaperless: mocks.connect,
  disconnectPaperless: mocks.disconnect,
  savePaperlessSettings: mocks.save,
}));
vi.mock("@/hooks/use-paperless", () => ({
  usePaperlessSettings: () => ({
    data: {
      allowed: mocks.allowed,
      enabled: mocks.enabled,
      connected: mocks.connected,
      encryptionReady: true,
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: mocks.refetch,
  }),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.connected = false;
  mocks.allowed = true;
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PaperlessSettings />
    </QueryClientProvider>,
  );
}

describe("personal Paperless settings", () => {
  it("hides the personal panel when the administrator has not granted access", () => {
    mocks.allowed = false;
    show();
    expect(screen.queryByText("Your Paperless connection")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Personal API token")).not.toBeInTheDocument();
  });
  it("sends a personal token only on explicit connection and clears the input on success", async () => {
    mocks.connect.mockResolvedValue({});
    const storage = vi.spyOn(Storage.prototype, "setItem");
    show();
    expect(mocks.connect).not.toHaveBeenCalled();
    const token = screen.getByLabelText("Personal API token");
    fireEvent.change(token, { target: { value: "private-token" } });
    expect(token).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith({ data: { token: "private-token" } }),
    );
    await waitFor(() => expect(token).toHaveValue(""));
    expect(storage).not.toHaveBeenCalled();
  });

  it("does not offer personal connection until an administrator enables the instance", () => {
    mocks.enabled = false;
    show();
    expect(screen.queryByLabelText("Personal API token")).not.toBeInTheDocument();
    expect(
      screen.getByText("An administrator must enable and configure Paperless first."),
    ).toBeInTheDocument();
  });

  it("shows failed connections explicitly and retains the token for correction", async () => {
    mocks.connect.mockRejectedValue(new Error("paperless.errors.unauthorized"));
    show();
    fireEvent.change(screen.getByLabelText("Personal API token"), {
      target: { value: "bad-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Paperless rejected your token");
    expect(screen.getByLabelText("Personal API token")).toHaveValue("bad-token");
  });
});
