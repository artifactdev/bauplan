// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrations";
import { attachIdeaPreviewInTransaction } from "./repo";

const databases: DatabaseSync[] = [];

function database() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  migrateDatabase(db);
  db.exec(`
    INSERT INTO projects (id, created_at, name, link_previews_enabled)
    VALUES ('project', '2026-01-01', 'Project', 1);
    INSERT INTO ideas (id, created_at, project_id, collection, title, url)
    VALUES ('idea', '2026-01-01', 'project', 'Kitchen', 'Tile', 'https://example.com/tile');
  `);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("attachIdeaPreviewInTransaction", () => {
  it("stores one local preview only when the project and idea still match", () => {
    const db = database();
    const image = {
      name: "link-preview.png",
      storage_path: "collections/Kitchen/preview.png",
      mime_type: "image/png",
      size: 8,
    };

    expect(
      attachIdeaPreviewInTransaction(db, "project", "idea", "https://example.com/tile", image),
    ).toBe(true);
    expect(
      db.prepare("SELECT source, storage_path FROM idea_images WHERE idea_id = 'idea'").get(),
    ).toEqual({ source: "link_preview", storage_path: image.storage_path });
    expect(
      attachIdeaPreviewInTransaction(db, "project", "idea", "https://example.com/tile", image),
    ).toBe(false);
    expect(db.prepare("SELECT id FROM idea_images WHERE idea_id = 'idea'").all()).toHaveLength(1);
  });

  it("does not attach a preview after the project is disabled or the URL changes", () => {
    const db = database();
    const image = {
      name: "link-preview.png",
      storage_path: "collections/Kitchen/preview.png",
      mime_type: "image/png",
      size: 8,
    };
    db.prepare("UPDATE projects SET link_previews_enabled = 0 WHERE id = 'project'").run();

    expect(
      attachIdeaPreviewInTransaction(db, "project", "idea", "https://example.com/tile", image),
    ).toBe(false);
    db.prepare("UPDATE projects SET link_previews_enabled = 1 WHERE id = 'project'").run();
    expect(
      attachIdeaPreviewInTransaction(db, "project", "idea", "https://example.com/other", image),
    ).toBe(false);
    expect(db.prepare("SELECT id FROM idea_images").all()).toEqual([]);
  });
});
