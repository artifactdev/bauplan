// @vitest-environment node
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSharedFiles, removeSharedFile, SHARE_CACHE } from "./share-inbox";

type FetchEvent = { request: Request; respondWith: (response: Promise<Response>) => void };
const origin = "https://bauplan.example";
let listener: (event: FetchEvent) => void;
let entries: Map<string, Response>;
let cache: {
  keys: ReturnType<typeof vi.fn>;
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  entries = new Map();
  cache = {
    keys: vi.fn(async () => [...entries.keys()].map((key) => new Request(key))),
    match: vi.fn(async (key: Request | string) =>
      entries.get(typeof key === "string" ? key : key.url)?.clone(),
    ),
    put: vi.fn(async (key: string, response: Response) => {
      entries.set(key, response.clone());
    }),
    delete: vi.fn(async (key: Request | string) =>
      entries.delete(typeof key === "string" ? key : key.url),
    ),
  };
  vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
  const source = await readFile(new URL("../../public/share-target.js", import.meta.url), "utf8");
  runInNewContext(source, {
    self: {
      location: { origin },
      addEventListener: (name: string, callback: typeof listener) => {
        expect(name).toBe("fetch");
        listener = callback;
      },
    },
    caches,
    URL,
    Response,
    crypto,
    console: { error: vi.fn() },
    Date,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function share(files: (File | string)[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  let response: Promise<Response> | undefined;
  listener({
    request: new Request(`${origin}/share-target`, { method: "POST", body: form }),
    respondWith: (value) => {
      response = value;
    },
  });
  if (!response) throw new Error("Share target did not handle POST");
  return response;
}

describe("PWA share receiver and local inbox", () => {
  it("receives multiple files without a server upload and restores names, types and bytes", async () => {
    const response = await share([
      new File(["%PDF-1.7"], "Angebot Küche.pdf", { type: "application/pdf" }),
      new File(["photo"], "Beleg.jpg", { type: "image/jpeg" }),
    ]);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/?shared=1`);
    expect(caches.open).toHaveBeenCalledWith(SHARE_CACHE);
    const files = await listSharedFiles();
    expect(files.map(({ file }) => [file.name, file.type])).toEqual([
      ["Angebot Küche.pdf", "application/pdf"],
      ["Beleg.jpg", "image/jpeg"],
    ]);
    expect(await files[0]!.file.text()).toBe("%PDF-1.7");
    await removeSharedFile(files[0]!.key);
    expect((await listSharedFiles()).map(({ file }) => file.name)).toEqual(["Beleg.jpg"]);
  });

  it("infers PDF MIME type when a scanner omits it", async () => {
    const response = await share([new File(["pdf"], "scan.PDF")]);
    expect(response.headers.get("location")).toBe(`${origin}/?shared=1`);
    expect((await listSharedFiles())[0]!.file.type).toBe("application/pdf");
  });

  it.each([
    [],
    ["not a file"],
    [new File([], "empty.pdf", { type: "application/pdf" })],
    [new File(["bad"], "script.html", { type: "text/html" })],
    [new File(["pdf"], "scan.pdf", { type: "text/html" })],
  ])("rejects invalid batches without retaining partial files: %j", async (...files) => {
    const response = await share(files);
    expect(response.headers.get("location")).toBe(`${origin}/?share_error=invalid`);
    expect(entries.size).toBe(0);
  });

  it("enforces the exact 100 MB total inbox limit", async () => {
    entries.set(
      `${origin}/__share-inbox/existing`,
      new Response("existing", {
        headers: {
          "x-shared-at": String(Date.now()),
          "x-file-size": String(100 * 1024 * 1024 - 1),
        },
      }),
    );
    expect(
      (await share([new File(["1"], "a.pdf", { type: "application/pdf" })])).headers.get(
        "location",
      ),
    ).toBe(`${origin}/?shared=1`);
    expect(
      (await share([new File(["2"], "b.pdf", { type: "application/pdf" })])).headers.get(
        "location",
      ),
    ).toBe(`${origin}/?share_error=too_large`);
    expect(entries.size).toBe(2);
  });

  it("rolls back a batch if storing a later file fails", async () => {
    const put = cache.put.getMockImplementation()!;
    cache.put.mockImplementationOnce(put).mockRejectedValueOnce(new Error("quota"));
    const response = await share([
      new File(["pdf"], "a.pdf", { type: "application/pdf" }),
      new File(["pdf"], "b.pdf", { type: "application/pdf" }),
    ]);
    expect(response.headers.get("location")).toBe(`${origin}/?share_error=storage`);
    expect(entries.size).toBe(0);
  });

  it("expires pending files after 24 hours on inbox read", async () => {
    await share([new File(["pdf"], "a.pdf", { type: "application/pdf" })]);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 86400001);
    expect(await listSharedFiles()).toEqual([]);
    expect(entries.size).toBe(0);
  });

  it("cleans expired files before counting inbox capacity", async () => {
    entries.set(
      `${origin}/__share-inbox/old`,
      new Response("old", {
        headers: { "x-shared-at": String(Date.now() - 86400001), "x-file-size": "104857600" },
      }),
    );
    const response = await share([new File(["pdf"], "new.pdf", { type: "application/pdf" })]);
    expect(response.headers.get("location")).toBe(`${origin}/?shared=1`);
    expect(entries.size).toBe(1);
  });

  it("does not intercept normal requests or a different origin", () => {
    for (const request of [
      new Request(`${origin}/share-target`),
      new Request(`${origin}/api/upload`, { method: "POST" }),
      new Request("https://other.example/share-target", { method: "POST" }),
    ]) {
      const respondWith = vi.fn();
      listener({ request, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });

  it("surfaces cache access failures instead of returning an empty inbox", async () => {
    vi.mocked(caches.open).mockRejectedValueOnce(new Error("denied"));
    await expect(listSharedFiles()).rejects.toThrow("denied");
  });
});
