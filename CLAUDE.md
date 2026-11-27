# GitHub UI Enhancer

## Worum es geht

Eine Browser-Erweiterung für Chrome/Chromium und Firefox (Manifest V3). Sie ersetzt die Startseite von github.com für eingeloggte Nutzer durch ein eigenes Dashboard aus Widgets. Zielgruppe ist jemand, der täglich mit vielen Repos in mehreren Orgas arbeitet und GitHubs eigene Startseite dafür nutzlos findet.

- Ganz oben steht immer eine orga-übergreifende Repo-Suche. Sie ist das einzige Widget, das genau einmal vorkommt.
- Alle anderen Widgets (PR-Listen, Issue-Listen, Actions-Runs eines Repos) können beliebig oft mit eigener Konfiguration platziert werden.
- Neue Widgets sollen sich ergänzen lassen, ohne den Rest anzufassen. Widgets sprechen deshalb nur über eine definierte Schnittstelle mit der Datenschicht und kennen weder Tokens noch `fetch`.

Hintergrund, Recherche und Begründungen stehen in `docs/machbarkeit.md`, der Umsetzungsplan in `docs/plan.md`.

## Feste Entscheidungen, die man dem Code nicht ansieht

- **Daten kommen nur aus der offiziellen GitHub-API.** Undokumentierte Endpunkte von github.com sind tabu, auch wenn sie bequemer wären.
- **Die Erweiterung schreibt nie etwas nach GitHub.** Sie nutzt ausschließlich fine-grained PATs mit Leserechten, eines pro Resource Owner (Account oder Orga). Classic PATs werden bewusst nicht unterstützt. Der API-Client blockt zusätzlich alles außer lesenden Aufrufen.
- **Tokens verlassen den Background-Kontext nie.** Sie gelangen nicht ins Content Script, nicht in `storage.sync`, nicht in Logs oder Fehlermeldungen.
- **Im Zweifel bleibt GitHubs Originalseite stehen.** Findet die Erweiterung ihren Einhängepunkt nicht, blendet sie nichts aus. Eine leere Startseite ist schlimmer als die unveränderte.
- **Die Kopplung an GitHubs Markup bleibt an einer Stelle gebündelt.** Ändert GitHub das DOM, soll nur dieses eine Modul angepasst werden müssen.
- **Die Rate-Limits gelten pro Nutzer, nicht pro Token.** Mehrere Tokens erhöhen das Budget nicht. Abfragen deshalb cachen, deduplizieren und bündeln.

## Arbeitsregeln

### Abhängigkeiten

- Paketmanager ist pnpm, nicht npm. Auch `npx` vermeiden, stattdessen `pnpm exec` bzw. `pnpm dlx`.
- pnpm lehnt Pakete ab, die jünger als die Mindestwartezeit sind. Dafür keine Ausnahme eintragen, sondern eine ältere Version wählen.
- So wenige Libraries wie möglich. Laufzeit-Abhängigkeiten gibt es grundsätzlich keine.
- Kleine Helfer (DOM-Aufbau, Fuzzy-Suche, Cache) werden selbst geschrieben, statt ein Paket dafür zu holen.
- Jede neue Abhängigkeit, auch eine reine Dev-Abhängigkeit, nur nach Rückfrage beim Nutzer.
- Code ist TypeScript mit strikten Compiler-Einstellungen. `any` und Typ-Casts nur mit gutem Grund.

### Tests

- Möglichst jeder Code-Pfad ist durch Tests abgedeckt, auch Fehler- und Randfälle (abgelaufenes Token, 403, leere Ergebnisse, Paginierung, Navigation weg von der Startseite).
- Code wird so geschnitten, dass er testbar ist: Logik getrennt von Browser-APIs, Abhängigkeiten werden hineingereicht statt global geholt.
- Nur reine Verdrahtung in den Einstiegspunkten darf ungetestet bleiben.
- Tests mit Zeitbudgets heißen `*.perf.ts` und laufen nur über `pnpm test:perf`, nicht in `pnpm check`. Unter Last (z. B. viele parallele Agents) schlagen sie sonst zufällig fehl.

### Kommentare

- Bevor ein Kommentar entsteht, prüfen: Erklärt er nur, was der Code ohnehin sagt? Dann weglassen und lieber den Code klarer benennen.
- Ein Kommentar gehört dorthin, wo etwas nicht aus dem Code ablesbar ist: Seiteneffekte, Eigenheiten von GitHub oder den Browsern, Gründe für eine ungewöhnliche Lösung, bewusste Einschränkungen.

### Schreibweise

- Keine langen Gedankenstriche (Halbgeviertstrich U+2013, Geviertstrich U+2014), weder in Code, Kommentaren, Doku noch Commit-Messages. Immer den kurzen Bindestrich `-` verwenden.

### Commits

- In kleinen Schritten committen, die jeweils für sich funktionieren: Build, Typecheck und Tests sind vor jedem Commit grün.
- Commit-Messages folgen Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `build:`, `chore:`, optional mit Scope wie `feat(search): ...`).
- Keine `Co-Authored-By`-Zeile und kein sonstiger Hinweis auf KI-Beteiligung in Commits.
