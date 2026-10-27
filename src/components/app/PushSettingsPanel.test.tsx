import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import {
  getPushConfiguration,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from "@/lib/data.functions";
import { PushSettingsPanel } from "./PushSettingsPanel";

vi.mock("@/lib/data.functions", () => ({
  getPushConfiguration: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
  sendTestPush: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const permission = vi.fn();
const subscribe = vi.fn();
const unsubscribe = vi.fn();
const endpoint = "https://web.push.apple.com/device";
const device = {
  endpoint,
  options: {},
  unsubscribe,
  toJSON: () => ({ keys: { auth: "b".repeat(22), p256dh: "a".repeat(87) } }),
};
let current: typeof device | null;
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  current = null;
  vi.stubGlobal("Notification", { requestPermission: permission });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => ({
        active: {},
        pushManager: {
          getSubscription: vi.fn(async () => current),
          subscribe,
        },
      })),
    },
  });
  permission.mockResolvedValue("granted");
  subscribe.mockResolvedValue(device);
  unsubscribe.mockResolvedValue(true);
  vi.mocked(getPushConfiguration).mockResolvedValue({ publicKey: "a".repeat(87), endpoints: [] });
  vi.mocked(subscribePush).mockResolvedValue({ ok: true });
  vi.mocked(unsubscribePush).mockResolvedValue({ ok: true });
  vi.mocked(sendTestPush).mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("per-device push settings", () => {
  it("does not wait for a subscription while the service worker is inactive", async () => {
    const getSubscription = vi.fn(() => new Promise<PushSubscription | null>(() => {}));
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("Missing test registration");
    Object.defineProperty(registration, "active", { value: null });
    registration.pushManager.getSubscription = getSubscription;
    vi.mocked(navigator.serviceWorker.getRegistration).mockResolvedValue(registration);
    render(<PushSettingsPanel userId="alice" />);
    expect(
      await screen.findByRole("button", { name: "Enable on this device" }),
    ).toBeInTheDocument();
    expect(getSubscription).not.toHaveBeenCalled();
  });
  it("requests permission only on explicit enable and registers the subscription for this account", async () => {
    render(<PushSettingsPanel userId="alice" />);
    const enable = await screen.findByRole("button", { name: "Enable on this device" });
    expect(permission).not.toHaveBeenCalled();
    fireEvent.click(enable);
    await screen.findByRole("button", { name: "Disable on this device" });
    expect(permission).toHaveBeenCalledOnce();
    expect(subscribePush).toHaveBeenCalledWith({
      data: {
        subscription: { endpoint, keys: { auth: "b".repeat(22), p256dh: "a".repeat(87) } },
        language: "en",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test notification" }));
    await waitFor(() => expect(sendTestPush).toHaveBeenCalledWith({ data: { endpoint } }));
  });
  it("removes the server registration and browser subscription on disable", async () => {
    current = device;
    vi.mocked(getPushConfiguration).mockResolvedValue({
      publicKey: "a".repeat(87),
      endpoints: [endpoint],
    });
    render(<PushSettingsPanel userId="alice" />);
    fireEvent.click(await screen.findByRole("button", { name: "Disable on this device" }));
    await screen.findByRole("button", { name: "Enable on this device" });
    expect(unsubscribePush).toHaveBeenCalledWith({ data: { endpoint } });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("does not mistake another account's browser subscription for an enabled device", async () => {
    current = device;
    render(<PushSettingsPanel userId="alice" />);
    expect(
      await screen.findByRole("button", { name: "Enable on this device" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test notification" })).not.toBeInTheDocument();
  });
  it("surfaces denied permission without claiming success", async () => {
    permission.mockResolvedValue("denied");
    render(<PushSettingsPanel userId="alice" />);
    fireEvent.click(await screen.findByRole("button", { name: "Enable on this device" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(subscribePush).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("explains missing server configuration", async () => {
    vi.mocked(getPushConfiguration).mockResolvedValue({ publicKey: null, endpoints: [] });
    render(<PushSettingsPanel userId="alice" />);
    expect(await screen.findByRole("status")).toHaveTextContent("admin account");
    expect(permission).not.toHaveBeenCalled();
  });
});
