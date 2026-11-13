import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import { CalendarSyncPanel } from "./CalendarSyncPanel";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("de");
});

describe("CalDAV setup", () => {
  it("shows personal setup using existing credentials and a read-only server address", () => {
    render(
      <CalendarSyncPanel
        email="member@example.test"
        projectId="project-main"
        primaryProjectId="project-main"
        projectName="Main project"
      />,
    );
    expect(screen.getByLabelText("Benutzername")).toHaveValue("member@example.test");
    const server = screen.getByLabelText("Serveradresse");
    expect(server).toHaveValue(`${window.location.origin}/api/caldav/`);
    expect(screen.getByText("Aktives Projekt: Main project")).toBeInTheDocument();
    expect(server).toHaveAttribute("readonly");
    expect(screen.getByText(/Verwende dein bestehendes Bauplan-Passwort/)).toBeInTheDocument();
    expect(screen.getByText(/Serientermine werden ausdrücklich abgelehnt/)).toBeInTheDocument();
  });

  it("uses a separate server path for another project", () => {
    render(
      <CalendarSyncPanel
        email="member@example.test"
        projectId="project-second"
        primaryProjectId="project-main"
        projectName="Second project"
      />,
    );
    expect(screen.getByLabelText("Serveradresse")).toHaveValue(
      `${window.location.origin}/api/caldav/projects/project-second/`,
    );
  });

  it("reports clipboard failures rather than showing success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(
      <CalendarSyncPanel
        email="member@example.test"
        projectId="project-main"
        primaryProjectId="project-main"
        projectName="Main project"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Serveradresse kopieren" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Serveradresse konnte nicht kopiert werden."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("provides English setup instructions", async () => {
    await i18n.changeLanguage("en");
    render(
      <CalendarSyncPanel
        email="member@example.test"
        projectId="project-main"
        primaryProjectId="project-main"
        projectName="Main project"
      />,
    );
    expect(screen.getByLabelText("Server address")).toBeInTheDocument();
    expect(screen.getByText(/Use your existing Bauplan password/)).toBeInTheDocument();
  });
});
