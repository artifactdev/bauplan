import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appearanceBootstrap } from "@/lib/appearance";
import { Route } from "./__root";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  HeadContent: () => null,
  Scripts: () => null,
}));

afterEach(() => vi.restoreAllMocks());

describe("appearance bootstrap hydration", () => {
  it("renders the serialized loader script instead of regenerating the client build's script", () => {
    // Server and browser transforms can produce different Function.toString() output.
    const serverBootstrap = `${appearanceBootstrap}\n/* server transform */`;
    const serialized = JSON.parse(JSON.stringify({ appearanceBootstrap: serverBootstrap }));
    vi.spyOn(Route, "useLoaderData").mockReturnValue(serialized);
    const options = Route.options;
    if (!("shellComponent" in options) || typeof options.shellComponent !== "function")
      throw new Error("Missing root shell");
    const shell: unknown = options.shellComponent({ children: <main>Content</main> });
    if (!isValidElement(shell)) throw new Error("Root shell did not return an element");
    const markup = renderToStaticMarkup(shell);
    const document = new DOMParser().parseFromString(markup, "text/html");
    const script = document.head.querySelector("script");
    expect(script?.textContent).toBe(serverBootstrap);
    expect(script?.textContent).not.toBe(appearanceBootstrap);
    expect(document.body.textContent).toBe("Content");
    expect(document.head.firstElementChild).toBe(script);
  });
});
