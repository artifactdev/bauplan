import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { Route } from "./route";

const state = vi.hoisted(() => ({ online: true, pending: 0 }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  Outlet: () => null,
  useRouterState: () => "/aufgaben",
}));
vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({ ws: { projects: [] }, isLoading: true }),
  useMutations: () => ({}),
  useOfflineSync: () => ({ ...state, conflicts: [], syncing: false, sync: vi.fn() }),
}));
vi.mock("@/hooks/use-navigation", () => ({
  useNavigation: () => ({}),
  useNavItems: () => ({ navigation: {}, items: [] }),
}));
vi.mock("@/components/app/AppearanceProvider", () => ({
  AccountAppearance: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/app/ProjectDialog", () => ({ ProjectDialog: () => null }));
vi.mock("@/components/app/SharedImport", () => ({ SharedImport: () => null }));

beforeEach(async () => {
  state.online = true;
  state.pending = 0;
  await i18n.changeLanguage("en");
  vi.spyOn(Route, "useRouteContext").mockReturnValue({
    backend: { dataDir: "", uploadsDir: "" },
    auth: {
      needsSetup: false,
      oidc: { enabled: false, label: "" },
      user: { id: "alice", email: "alice@example.test", name: "Alice", role: "admin" },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function header() {
  const Page = Route.options.component;
  if (!Page) throw new Error("Missing layout component");
  render(<Page />);
  return within(screen.getByRole("banner"));
}

describe("workspace header", () => {
  it("omits normal online status and the display-mode switch", () => {
    const bar = header();
    expect(bar.queryByRole("status")).not.toBeInTheDocument();
    expect(bar.queryByRole("button", { name: /Display mode/ })).not.toBeInTheDocument();
    expect(bar.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });
  it("shows offline status even without queued changes", () => {
    state.online = false;
    expect(header().getByRole("status")).toHaveTextContent("Offline");
  });
  it("retains queued-change status and synchronization controls while online", () => {
    state.pending = 2;
    const bar = header();
    expect(bar.getByRole("status")).not.toHaveTextContent("Online");
    expect(bar.getByRole("status")).toHaveTextContent("2");
    expect(bar.getByRole("button", { name: "Sync changes now" })).toBeInTheDocument();
  });
});
