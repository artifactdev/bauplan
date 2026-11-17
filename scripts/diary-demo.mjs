export async function addDiaryArchiveDemo(repo, projectId) {
  const ws = await repo.getAll(projectId);
  const titles = new Set(ws.diary_entries.map((entry) => entry.title));
  const today = new Date();
  for (let month = 1; month <= 30; month++) {
    for (const day of [5, 14, 24]) {
      const date = new Date(today.getFullYear(), today.getMonth() - month, day, 12);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      const entry_date = date.toISOString().slice(0, 10);
      const title = `Demo: Kontrollgang ${entry_date}`;
      if (titles.has(title)) continue;
      await repo.insert(
        "diary_entries",
        {
          title,
          entry_date,
          work_done:
            day === 5
              ? "Bauzustand, Materiallager und die Zugänge zur Baustelle beim gemeinsamen Kontrollgang geprüft."
              : day === 14
                ? "Den Arbeitsstand mit den beteiligten Handwerkern abgeglichen und die nächsten Arbeitsschritte besprochen."
                : "Die ausgeführten Arbeiten kontrolliert und offene Punkte für die nächste Baubesprechung festgehalten.",
          progress:
            "Fiktiver Archivbericht für die Navigation durch ein länger laufendes Bauprojekt.",
          issues:
            day === 14
              ? "Die nächsten Liefertermine müssen vor dem Folgegewerk bestätigt werden."
              : null,
        },
        undefined,
        projectId,
      );
    }
  }
}

export async function addDiarySubtaskDemo(repo, projectId) {
  const ws = await repo.getAll(projectId);
  const localDay = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  };
  const today = localDay(0);
  const yesterday = localDay(-1);
  const title = "Demo: Elektro-Rohinstallation prüfen";
  let task = ws.tasks.find((item) => item.title === title);
  if (!task) {
    const created = await repo.insert(
      "tasks",
      {
        title,
        status: "in_arbeit",
        priority: "mittel",
        trade_id: ws.trades.find((trade) => trade.name.includes("Elekt"))?.id ?? null,
        notes: "Fiktives Beispiel: eigenständig erledigte Unteraufgaben einer laufenden Aufgabe.",
      },
      undefined,
      projectId,
    );
    task = (await repo.getAll(projectId)).tasks.find((item) => item.id === created.id);
    if (!task) throw new Error("Demo subtask parent was not created");
  }
  const fixtures = [
    {
      id: "demo-diary-today",
      title: "Leitungswege fotografieren",
      done: true,
      completed_at: `${today}T10:00:00Z`,
      completed_on: today,
    },
    {
      id: "demo-diary-yesterday",
      title: "Dosenpositionen abgleichen",
      done: true,
      completed_at: `${yesterday}T10:00:00Z`,
      completed_on: yesterday,
    },
    { id: "demo-diary-legacy", title: "Altbestand sichten", done: true },
    { id: "demo-diary-open", title: "Messprotokoll ergänzen", done: false },
  ];
  const previous = JSON.parse(task.checklist ?? "[]");
  const reset = new Set(
    fixtures
      .filter(
        (item) =>
          item.completed_on &&
          previous.some(
            (old) => old.id === item.id && old.done && old.completed_on !== item.completed_on,
          ),
      )
      .map((item) => item.id),
  );
  // Only these explicitly fictional daily examples roll forward when re-seeding.
  if (reset.size)
    await repo.update(
      "tasks",
      task.id,
      {
        checklist: JSON.stringify(
          previous.map((item) =>
            reset.has(item.id)
              ? { ...item, done: false, completed_at: null, completed_on: null }
              : item,
          ),
        ),
      },
      undefined,
      projectId,
    );
  await repo.update(
    "tasks",
    task.id,
    {
      checklist: JSON.stringify([
        ...fixtures,
        ...previous.filter((item) => !fixtures.some((fixture) => fixture.id === item.id)),
      ]),
    },
    undefined,
    projectId,
  );
  const reportTitle = "Demo: Tagesfortschritt mit Unteraufgaben";
  const row = {
    title: reportTitle,
    entry_date: today,
    work_done:
      "Leitungswege als einzelne Unteraufgabe der noch laufenden Elektro-Rohinstallation dokumentiert.",
    progress: "Die Fotos liegen vor; das Messprotokoll steht noch aus.",
    subtask_links: JSON.stringify([
      { task_id: task.id, subtask_id: "demo-diary-today" },
      { task_id: task.id, subtask_id: "demo-diary-legacy" },
    ]),
  };
  const report = ws.diary_entries.find((item) => item.title === reportTitle);
  if (report) await repo.update("diary_entries", report.id, row, undefined, projectId);
  else await repo.insert("diary_entries", row, undefined, projectId);
}
