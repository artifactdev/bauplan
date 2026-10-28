import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import { loginLocal } from "@/lib/auth.functions";
import { Route } from "./auth";

vi.mock("@/lib/auth.functions", () => ({
  getAuthState: vi.fn(),
  loginLocal: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  vi.spyOn(Route, "useRouteContext").mockReturnValue({
    backend: { dataDir: "", uploadsDir: "" },
    oidc: { enabled: false, label: "" },
  });
  vi.spyOn(Route, "useSearch").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAuth() {
  const Page = Route.options.component;
  if (!Page) throw new Error("Missing auth component");
  render(<Page />);
}

describe("sign-in page", () => {
  it("uses the app icon, local photo attribution and password-manager fields", () => {
    renderAuth();
    const icons = document.querySelectorAll('img[src="/app-icon-192.png"]');
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon).toHaveAttribute("alt", "");
    expect(screen.getByRole("link", { name: "Photo: Spacejoy / Unsplash" })).toHaveAttribute(
      "href",
      "https://unsplash.com/photos/RqO6kwm4tZY",
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryByRole("button", { name: "Company SSO" })).not.toBeInTheDocument();
  });

  it("retains optional SSO and displays redirect errors accessibly", () => {
    vi.mocked(Route.useRouteContext).mockReturnValue({
      backend: { dataDir: "", uploadsDir: "" },
      oidc: { enabled: true, label: "Company SSO" },
    });
    vi.mocked(Route.useSearch).mockReturnValue({ fehler: "Sign-in was declined" });
    renderAuth();
    expect(screen.getByRole("button", { name: "Company SSO" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in was declined");
  });

  it("submits credentials, prevents repeat submissions and recovers after failure", async () => {
    let rejectLogin: (reason: Error) => void = () => {};
    vi.mocked(loginLocal).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectLogin = reject;
        }),
    );
    renderAuth();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "incorrect" } });
    const submit = screen.getByRole("button", { name: "Sign in" });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(loginLocal).toHaveBeenCalledWith({
      data: { email: "owner@example.test", password: "incorrect" },
    });
    rejectLogin(new Error("Invalid credentials"));
    await waitFor(() => expect(submit).toBeEnabled());
    expect(toast.error).toHaveBeenCalledWith("Invalid credentials");
  });
});
