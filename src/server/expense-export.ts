import { zipSync } from "fflate";
import { expenseDocuments } from "@/lib/expenses";
import type { Repo } from "./repo";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_EXPENSES = 1000;

function safeName(value: string) {
  const name = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? "_" : character,
  )
    .join("")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return name.slice(0, 120) || "document";
}

export async function exportExpenseDocuments(
  repo: Pick<Repo, "getAll" | "readFile">,
  projectId: string,
  ids: string[],
) {
  if (!ids.length || ids.length > MAX_EXPENSES || new Set(ids).size !== ids.length)
    throw new Error("expenses.export_empty");
  const workspace = await repo.getAll(projectId);
  const expenses = ids.map((id) => workspace.expenses.find((expense) => expense.id === id));
  if (expenses.some((expense) => !expense)) throw new Error("projects.row_not_in_project");
  const documents = new Map(workspace.documents.map((document) => [document.id, document]));
  const files = new Map<string, Uint8Array>();
  const selectedDocuments = new Map<string, (typeof workspace.documents)[number]>();
  const entries: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  let total = 0;
  let count = 0;
  for (const [index, expense] of expenses.entries()) {
    if (!expense) throw new Error("projects.row_not_in_project");
    const links = expenseDocuments(expense);
    let incomplete = !links.some((link) => link.role === "invoice");
    for (const [documentIndex, link] of links.entries()) {
      if (++count > 10_000) throw new Error("expenses.export_large");
      const document = documents.get(link.document_id);
      if (!document?.storage_path) {
        incomplete = true;
        continue;
      }
      if (document.size != null && Number(document.size) > MAX_BYTES)
        throw new Error("expenses.export_large");
      let bytes = files.get(document.id);
      if (!bytes) {
        const found = await repo.readFile(document.storage_path, MAX_BYTES - total);
        if (!found) {
          incomplete = true;
          continue;
        }
        bytes = found;
        files.set(document.id, bytes);
      }
      total += bytes.byteLength;
      if (total > MAX_BYTES) throw new Error("expenses.export_large");
      selectedDocuments.set(document.id, document);
      entries[
        `${index + 1}-${safeName(expense.title)}/${documentIndex + 1}-${safeName(document.name)}`
      ] = bytes;
    }
    if (incomplete) missing.push(expense.title);
  }
  if (missing.length) return { missing } as const;
  return {
    archive: Buffer.from(zipSync(entries, { level: 0 })).toString("base64"),
    expenses: expenses.filter((expense) => expense !== undefined),
    documents: [...selectedDocuments.values()],
  } as const;
}
