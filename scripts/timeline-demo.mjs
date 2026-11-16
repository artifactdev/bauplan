// Adds fictional planning records without modifying existing project data.
export async function addTimelineDemo(repo, projectId) {
  const ws = await repo.getAll(projectId);
  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const date = (offset) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + offset);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  };
  const trades = [
    ["Rückbau", "#9a5837"],
    ["Bad & Sanitär", "#287a80"],
    ["Elektrik", "#b57b18"],
    ["Trockenbau", "#7056a1"],
    ["Malerarbeiten", "#588160"],
    ["Bodenbeläge", "#9b6849"],
    ["Küche", "#658293"],
  ];
  const tradeIds = new Map();
  for (const [name, color] of trades) {
    const existing = ws.trades.find((trade) => trade.name === name);
    tradeIds.set(
      name,
      existing?.id ??
        (await repo.insert("trades", { name, color, budget: 0 }, undefined, projectId)).id,
    );
  }
  const works = [
    ["rueckbau", "Demo: Bad zurückbauen und entsorgen", "Rückbau", -7, -3, true],
    ["elektro", "Demo: Elektro-Rohinstallation EG und OG", "Elektrik", 0, 5, false],
    ["sanitaer", "Demo: Wasserleitungen und Vorwandinstallation", "Bad & Sanitär", 2, 8, false],
    ["trockenbau", "Demo: Vorwände und Decken schließen", "Trockenbau", 10, 15, false],
    ["abdichtung", "Demo: Bad abdichten", "Bad & Sanitär", 16, 18, false],
    ["fliesen", "Demo: Wand- und Bodenfliesen verlegen", "Bad & Sanitär", 21, 27, false],
    ["maler", "Demo: Wände und Decken vorbereiten", "Malerarbeiten", 21, 26, false],
    ["anstrich", "Demo: Wohnräume streichen", "Malerarbeiten", 30, 34, false],
    ["boden", "Demo: Parkett im Wohnbereich verlegen", "Bodenbeläge", 36, 41, false],
    ["sanitaer-end", "Demo: Armaturen und Sanitär montieren", "Bad & Sanitär", 36, 39, false],
    ["kueche", "Demo: Küche liefern und montieren", "Küche", 44, 47, false],
    ["elektro-end", "Demo: Schalter und Leuchten montieren", "Elektrik", 49, 52, false],
  ];
  const ids = new Map();
  for (const [key, title, trade, start, end, done] of works) {
    const existing = ws.events.find((event) => event.title === title);
    const row =
      existing ??
      (await repo.insert(
        "events",
        {
          title,
          kind: "arbeit",
          trade_id: tradeIds.get(trade),
          event_date: date(start),
          end_date: date(end),
          start_time: null,
          end_time: null,
          work_completed: done,
          notes: "Fiktiver Sanierungsablauf.",
        },
        undefined,
        projectId,
      ));
    ids.set(key, row.id);
  }
  const tasks = [
    ["leitungen", "Demo: Leitungsverläufe fotografieren", "Elektrik", 6, 7, "event", "elektro", 0],
    [
      "pruefung",
      "Demo: Druckprüfung dokumentieren",
      "Bad & Sanitär",
      9,
      10,
      "event",
      "sanitaer",
      0,
    ],
    [
      "waende",
      "Demo: Geschlossene Wände zur Abnahme prüfen",
      "Trockenbau",
      16,
      17,
      "event",
      "trockenbau",
      0,
    ],
    [
      "fliesenfreigabe",
      "Demo: Abdichtung vor Fliesen freigeben",
      "Bad & Sanitär",
      19,
      20,
      "event",
      "abdichtung",
      0,
    ],
    ["farbwahl", "Demo: Farbtöne und Muster freigeben", "Malerarbeiten", 22, 24, null, null, 0],
    [
      "bodenfreigabe",
      "Demo: Untergrund und Restfeuchte prüfen",
      "Bodenbeläge",
      34,
      35,
      "event",
      "anstrich",
      0,
    ],
    ["kuechenabnahme", "Demo: Küchenmontage abnehmen", "Küche", 48, 49, "event", "kueche", 0],
    [
      "abschluss",
      "Demo: Schlussbegehung und Mängelliste",
      "Elektrik",
      53,
      55,
      "event",
      "elektro-end",
      0,
    ],
  ];
  for (const [, title, trade, start, end, source, predecessor, lag] of tasks) {
    if (ws.tasks.some((task) => task.title === title)) continue;
    await repo.insert(
      "tasks",
      {
        title,
        trade_id: tradeIds.get(trade),
        phase: "Innenausbau",
        priority: "mittel",
        status: "offen",
        start_date: date(start),
        due_date: date(end),
        dependencies: source
          ? JSON.stringify([{ source, id: ids.get(predecessor), lag_days: lag }])
          : null,
        notes: "Fiktiver Sanierungsablauf.",
      },
      undefined,
      projectId,
    );
  }
}
