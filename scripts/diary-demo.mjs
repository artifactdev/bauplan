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
