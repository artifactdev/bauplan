// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { Repo } from "./repo";
import { exportExpenseDocuments } from "./expense-export";

const dir = mkdtempSync(join(tmpdir(), "bauplan-expense-export-"));
const previousData = process.env["DATA_DIR"];
const previousUploads = process.env["UPLOADS_DIR"];
let repo: Repo;

beforeAll(async () => {
  process.env["DATA_DIR"] = dir;
  process.env["UPLOADS_DIR"] = join(dir, "uploads");
  repo = (await import("./repo")).sqliteRepo();
  await repo.insert("projects", { id: "p", name: "Project" });
  const first = await repo.putFile(
    "invoice.pdf",
    "application/pdf",
    new TextEncoder().encode("invoice"),
  );
  const second = await repo.putFile(
    "payment.pdf",
    "application/pdf",
    new TextEncoder().encode("payment"),
  );
  await repo.insert(
    "documents",
    { id: "invoice", name: "../invoice.pdf", storage_path: first },
    undefined,
    "p",
  );
  await repo.insert(
    "documents",
    { id: "payment", name: "payment.pdf", storage_path: second },
    undefined,
    "p",
  );
  await repo.insert(
    "expenses",
    {
      id: "expense",
      title: "Invoice",
      amount: 100,
      status: "offen",
      document_id: "invoice",
      document_links: JSON.stringify([{ document_id: "payment", role: "payment" }]),
    },
    undefined,
    "p",
  );
});

afterAll(() => {
  if (previousData === undefined) delete process.env["DATA_DIR"];
  else process.env["DATA_DIR"] = previousData;
  if (previousUploads === undefined) delete process.env["UPLOADS_DIR"];
  else process.env["UPLOADS_DIR"] = previousUploads;
  rmSync(dir, { recursive: true, force: true });
});

describe("bank submission export", () => {
  it("exports the invoice and optional payment proof without unsafe paths", async () => {
    const result = await exportExpenseDocuments(repo, "p", ["expense"]);
    if (!result.archive || !result.expenses || !result.documents)
      throw new Error("Missing archive");
    const archive = unzipSync(Buffer.from(result.archive, "base64"));
    const names = Object.keys(archive);
    expect(names).toHaveLength(2);
    expect(names.every((name) => !name.includes("..") && !name.startsWith("/"))).toBe(true);
    expect(names.map((name) => strFromU8(archive[name]!)).sort()).toEqual(["invoice", "payment"]);
    await repo.markExpensesSubmitted("p", result.expenses, result.documents);
    expect(
      (await repo.getAll("p")).expenses.find((expense) => expense.id === "expense"),
    ).toMatchObject({
      status: "offen",
      bank_status: "eingereicht",
    });
  });

  it("blocks missing receipts and rejects expenses from another project", async () => {
    await repo.insert(
      "expenses",
      { id: "missing", title: "Missing", amount: 10, status: "bezahlt" },
      undefined,
      "p",
    );
    expect(await exportExpenseDocuments(repo, "p", ["expense", "missing"])).toEqual({
      missing: ["Missing"],
    });
    await repo.insert("projects", { id: "other", name: "Other" });
    await expect(exportExpenseDocuments(repo, "other", ["expense"])).rejects.toThrow(
      "projects.row_not_in_project",
    );
    await repo.insert("documents", { id: "other-document", name: "other.pdf" }, undefined, "other");
    await expect(
      repo.update(
        "expenses",
        "expense",
        { document_links: JSON.stringify([{ document_id: "other-document", role: "other" }]) },
        undefined,
        "p",
      ),
    ).rejects.toThrow("projects.related_record_not_in_project");
  });

  it("blocks the complete archive when a linked optional file is unavailable", async () => {
    const file = (await repo.getAll("p")).documents.find((document) => document.id === "payment");
    if (!file?.storage_path) throw new Error("Missing test file");
    await repo.deleteFile(file.storage_path);
    expect(await exportExpenseDocuments(repo, "p", ["expense"])).toEqual({ missing: ["Invoice"] });
    const restored = await repo.putFile(
      "payment.pdf",
      "application/pdf",
      new TextEncoder().encode("payment"),
    );
    // Repository file locations are managed separately from normal document updates.
    const { getSqliteDb } = await import("./repo");
    (await getSqliteDb())
      .prepare("UPDATE documents SET storage_path = ? WHERE id = ?")
      .run(restored, "payment");
  });

  it("does not partially change statuses if an exported expense changed", async () => {
    await repo.update("expenses", "expense", { bank_status: "einzureichen" }, undefined, "p");
    await repo.insert(
      "expenses",
      { id: "second", title: "Second", amount: 5, status: "bezahlt", document_id: "invoice" },
      undefined,
      "p",
    );
    const result = await exportExpenseDocuments(repo, "p", ["expense", "second"]);
    if (!result.archive || !result.expenses || !result.documents)
      throw new Error("Missing archive");
    await repo.update("expenses", "second", { title: "Changed" }, undefined, "p");
    await expect(
      repo.markExpensesSubmitted("p", result.expenses, result.documents),
    ).rejects.toThrow("expenses.export_conflict");
    expect(
      (await repo.getAll("p")).expenses.find((expense) => expense.id === "expense")?.bank_status,
    ).toBe("einzureichen");
    expect(
      (await repo.getAll("p")).expenses.find((expense) => expense.id === "second")?.bank_status,
    ).toBe("einzureichen");
  });
});
