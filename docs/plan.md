# Umsetzungsplan

Stand: 2026-11-26. Grundlage sind `docs/machbarkeit.md` und die Regeln in `CLAUDE.md`.

## Prinzip: erst Verträge, dann parallel

Damit Subagents gleichzeitig arbeiten können, ohne sich in die Quere zu kommen, gilt:

1. **Phase 0 legt alle gemeinsamen Verträge fest**: Typen, Nachrichtenprotokoll, Widget-Schnittstelle, Test-Fakes und Tooling. Diese Phase läuft sequenziell beim Orchestrator.
2. **Jedes Arbeitspaket besitzt eigene Verzeichnisse.** Kein Paket ändert Dateien eines anderen Pakets oder die Verträge in `src/shared/`. Braucht ein Paket eine Vertragsänderung, meldet es das zurück, statt sie selbst vorzunehmen.
3. **Pakete testen gegen Verträge, nicht gegen Implementierungen.** Abhängigkeiten auf andere Pakete werden über die Schnittstellen aus `src/shared/` mit Fakes ersetzt. Deshalb können z. B. die Widgets schon entstehen, bevor die Datenschicht fertig ist.
4. **Jeder Subagent arbeitet in einem eigenen Git-Worktree** auf einem eigenen Branch (`wp/<kürzel>-<name>`) und committet dort in kleinen Schritten. Der Orchestrator prüft jedes Ergebnis (Review, Typecheck, Tests, Coverage) und merged dann nach `main`.

### Definition of Done für jedes Paket

- `tsc` ohne Fehler, alle Tests grün, Coverage-Schwellen für die eigenen Dateien erreicht
- keine neue Abhängigkeit ohne Freigabe
- Regeln aus `CLAUDE.md` eingehalten: Kommentare nur für Nicht-Offensichtliches, nur kurze Bindestriche, Conventional Commits, kein `Co-Authored-By`
- kurze Rückmeldung an den Orchestrator: was gebaut wurde, offene Punkte, gewünschte Vertragsänderungen

## Geplante Struktur

```text
scripts/build.ts              Build: esbuild + Manifeste für Chrome und Firefox
src/shared/                   Verträge (Phase 0, danach eingefroren)
src/lib/                      reine Hilfsfunktionen ohne Browser-Bezug
src/background/github/        API-Client
src/background/cache/         Cache mit TTL
src/background/tokens/        Token-Registry
src/background/data/          Datenschicht: Routing, Merge, Bündelung, Message-Handler
src/background/index.ts       Verdrahtung
src/options/                  Options-Seite
src/content/mount/            Startseite erkennen und Einhängepunkt finden
src/content/host/             Widget-Host, Layout, Aktualisierung
src/content/index.ts          Verdrahtung
src/ui/                       DOM-Helfer, Icons, Basis-CSS, gemeinsame Komponenten
src/widgets/<typ>/            ein Verzeichnis pro Widget-Typ
test/fakes/                   Fakes für chrome.*, fetch und Datenschicht
```

## Abhängigkeitsgraph

```text
Phase 0   P0 Tooling ──▶ P1 Verträge + Fakes
                              │
Phase 1   ┌──────────┬────────┼─────────┬──────────┬─────────┐
          A Client   B Cache  C Tokens  D Mount    E UI-Kit  F Fuzzy
          │          │        │         │          │         │
Phase 2   └──▶ G Daten ◀──────┘         │          │         │
               I Options ◀── C, E       │          │         │
               H Host ◀──────────────── D, E       │         │
               W1 Suche ◀──────────────────────────E ◀───────┘
               W2 PR-Liste, W3 Issue-Liste, W4 Actions ◀── E
                              │
Phase 3   Integration, Build, Test im Browser
```

Phase 1 läuft mit 6 Subagents parallel, Phase 2 mit bis zu 8. Die Widgets (W1 bis W4) brauchen nur die Verträge und das UI-Kit, nicht die Datenschicht.

---

## Phase 0: Fundament (sequenziell, Orchestrator)

### P0 Tooling

- `git init`, `.gitignore`, `.editorconfig`
- `package.json` mit Dev-Abhängigkeiten `typescript`, `esbuild`, `@types/chrome`, `@types/node`, `happy-dom`
- `tsconfig.json` streng: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`
- `scripts/build.ts`: bündelt Background, Content Script und Options-Seite, schreibt `dist/chrome/` und `dist/firefox/` mit unterschiedlichem `background`-Key bzw. `browser_specific_settings`, Watch-Modus für die Entwicklung
- Test-Skript: `node --test` mit Coverage und festen Schwellen (Ziel: Zeilen und Funktionen 95 %, Branches 90 %), ausgenommen nur Einstiegspunkte und Tests
- Prüfskript, das lange Gedankenstriche in Quellcode und Doku findet und den Lauf fehlschlagen lässt
- Commit: `build: set up typescript, esbuild and test tooling`

### P1 Verträge und Fakes

`src/shared/`:

- **Domänentypen:** `RepoSummary`, `TokenEntry` (Owner, Status, Ablaufdatum, nie der Token selbst auf Content-Seite), `PullRequestItem` (inkl. Review-Status, CI-Status, Draft), `IssueItem`, `WorkflowRunItem`, `BranchItem`, `ApiError` mit Fehlerarten (`unauthorized`, `forbidden`, `sso_required`, `pending_approval`, `rate_limited`, `not_found`, `network`, `no_token_for_owner`)
- **Nachrichtenprotokoll** Content ↔ Background: typisierte Request/Response-Union, ein generischer `sendRequest`-Helper
- **Datenschnittstelle für Widgets** (`WidgetData`): `repoIndex()`, `searchPullRequests(filter)`, `searchIssues(filter)`, `subscribedIssues()`, `workflowRuns(repo, { branch? })`, `branches(repo)`. Widgets schreiben kein GraphQL selbst, damit die Datenschicht Anfragen bündeln kann.
- **Widget-Schnittstelle:** `WidgetDefinition<C>` (Typ, Titel, `singleton`, Default-Konfiguration, Konfigurationsformular, `mount` gibt eine Dispose-Funktion zurück) und `WidgetContext<C>` (`data`, `saveConfig`, `onRefresh`, `signal` für Abbruch)
- **Layout-Typen:** Liste von `{ id, type, config }`

`test/fakes/`:

- `chrome.storage.local/sync/session` und `chrome.runtime` Messaging im Speicher
- `fetch`-Fake mit Antwort-Skripten (Status, Header, Body), damit Paginierung, ETags und Fehler testbar sind
- Fake-Implementierung von `WidgetData` mit steuerbaren Antworten und Fehlern

Commit: `feat(shared): add contracts and test fakes`

---

## Phase 1: Basisbausteine (6 parallele Subagents)

| Paket | Verzeichnis | Inhalt | Testschwerpunkte |
|---|---|---|---|
| **A GitHub-Client** | `src/background/github/` | `restGet`, `graphql` mit Token pro Aufruf. Nur `GET` und GraphQL ohne `mutation`, alles andere wirft. ETag-Handling mit `If-None-Match`. Paginierung über `Link`. Rate-Limit-Header auswerten. Fehler auf `ApiError` abbilden (inkl. SSO-Header, „Resource not accessible“, pending). Ablaufdatum aus Response-Header lesen. | jede Fehlerart, 304, mehrseitige Paginierung, Block von Mutationen, Token nie in Fehlermeldungen |
| **B Cache** | `src/background/cache/` | Key-Value-Cache mit TTL auf Basis eines Storage-Adapters. Stale-while-revalidate. Gleichzeitige Anfragen auf denselben Key teilen sich einen Request. Größenbewusste Ablage für den Repo-Index. | Ablauf, Stale-Auslieferung, Dedupe paralleler Aufrufe, Fehler beim Revalidieren behalten alte Daten |
| **C Token-Registry** | `src/background/tokens/` | Tokens speichern (nur `storage.local`), validieren (Login muss zum github.com-Nutzer passen), Owner aus der Repo-Liste ableiten, Status und Ablaufdatum pflegen, Token für einen Owner liefern. Nutzt den Client nur über eine Schnittstelle. | ungültig, pending, abgelaufen, falscher Nutzer, Owner-Erkennung ohne Repos, manuelle Korrektur |
| **D Mount** | `src/content/mount/` | Startseite + eingeloggt erkennen, frühes Ausblenden per Klasse auf `<html>`, Einhängepunkt über Selektor-Kette, Fail-open, Reaktion auf Turbo-Events, `popstate`, `pushState`, `MutationObserver` zum Wiedereinhängen, Umschalten auf GitHubs Originalseite für die aktuelle Ansicht. Einzige Stelle mit GitHub-Selektoren. | jede Selektor-Stufe, kein Treffer → nichts ausgeblendet, Wegnavigieren entfernt Klasse, Wiedereinhängen nach DOM-Austausch, Umschalten hin und zurück |
| **E UI-Kit** | `src/ui/` | `h()`-Helfer, Octicons als SVG-Pfade, Basis-CSS mit Präfix `ghx-` auf Primer-Variablen, Komponenten: Widget-Rahmen mit Titel und Aktionen, Listenzeile für PR/Issue (Status-Icon, Repo, Titel, Labels, Meta), Status-Label, relative Zeitangabe, Lade-, Leer- und Fehlerzustand (inkl. Link für SSO/Freigabe). | jede Komponente in jedem Zustand, Escaping von Nutzertext |
| **F Fuzzy** | `src/lib/fuzzy.ts` | Repo-Suche: Treffer auf `owner/name` und Beschreibung, Gewichtung Präfix > Wortanfang > Teilstring > Subsequenz, Bonus für kürzlich gepusht, Markierung der Trefferstellen. Performant bei 10.000 Einträgen. | Rangfolge, Umlaute und Groß/Klein, leere Eingabe, Performance-Budget |

Commits pro Paket in kleinen Schritten, z. B. `feat(github): add read-only rest client`, `feat(github): map sso and approval errors`, `test(github): cover pagination`.

---

## Phase 2: Zusammensetzen und Widgets (bis zu 8 parallele Subagents)

| Paket | Verzeichnis | Abhängig von | Inhalt |
|---|---|---|---|
| **G Datenschicht** | `src/background/data/` | A, B, C | Implementiert `WidgetData`. Globale Abfragen auf alle Tokens verteilen, zusammenführen, über Node-ID deduplizieren. Repo-bezogene Abfragen zum Token des Owners routen. Such-Anfragen eines Aktualisierungs-Durchlaufs per GraphQL-Aliasing zu einer Query pro Token bündeln. Repo-Index mit 1 h TTL. Message-Handler für das Protokoll aus Phase 0. Teilfehler (ein Token kaputt) liefern Teilergebnis plus Fehlerliste. |
| **H Widget-Host** | `src/content/host/` | D, E | Registry für Widget-Definitionen, Layout laden und speichern, Instanzen erzeugen und sauber entsorgen, Suche fest oben, Widgets hinzufügen, entfernen, verschieben und konfigurieren, Aktualisierung im Intervall nur bei sichtbarem Tab, manueller Refresh, Schalter zur Originalseite. Bekommt `WidgetData` hineingereicht. |
| **I Options-Seite** | `src/options/` | C, E | Token-Liste verwalten (hinzufügen, prüfen, entfernen, Owner korrigieren), Status und Ablaufdatum anzeigen, Anleitung für die nötigen Berechtigungen, Cache leeren. Token nach dem Speichern nur maskiert. |
| **W1 Repo-Suche** | `src/widgets/repo-search/` | E, F | Singleton. Eingabefeld mit Tastatursteuerung (Pfeile, Enter öffnet, Cmd/Ctrl+Enter im neuen Tab), Filter nach Owner, archivierte ausblendbar, Hinweis auf Alter des Index und manuelles Neuladen. |
| **W2 PR-Liste** | `src/widgets/pr-list/` | E | Generisches PR-Widget mit Suchfilter. Presets: zugewiesen, Review angefragt, selbst erstellt. Zeigt Review- und CI-Status, Draft, Labels. |
| **W3 Issue-Liste** | `src/widgets/issue-list/` | E | Generisches Issue-Widget mit Suchfilter. Presets: zugewiesen, abonniert (Datenquelle `subscribedIssues`). |
| **W4 Actions-Runs** | `src/widgets/actions-runs/` | E | Repo-Auswahl aus dem Repo-Index, Branch-Filter mit Branch-Liste, Liste der letzten Runs mit Status, Workflow, Branch, Dauer, Auslöser. |

Die Widgets testen gegen den `WidgetData`-Fake aus Phase 0 und können deshalb parallel zu G und H laufen.

---

## Phase 3: Integration (sequenziell, Orchestrator)

1. Einstiegspunkte verdrahten: Background (Registry, Client, Cache, Datenschicht, Message-Handler), Content Script (Mount, Host, Widget-Registrierung), Options-Seite.
2. Build für beide Browser, Manifest prüfen (Permissions: `storage`, `unlimitedStorage`, `host_permissions` für `https://api.github.com/*`, Content Script auf `https://github.com/*`).
3. Test im Browser-Pane mit echten Tokens des Nutzers: Startseite ersetzt, Navigation hin und weg, Dark Mode, alle Widgets, Fehlerfälle (Token entfernt, Orga ohne Freigabe).
4. Offene Punkte aus `docs/machbarkeit.md` mit echten Tokens klären (Header für Ablaufdatum, Verhalten von `filter=subscribed` und GraphQL-Suche mit fine-grained Tokens).
5. `README.md` mit Installation, Token-Anleitung und Bekannten Einschränkungen.

---

## Entscheidungen (2026-11-26)

1. **DOM für Tests:** `happy-dom` kommt als zusätzliche Dev-Abhängigkeit dazu. Die Pakete D, E, H, I und W1 bis W4 testen damit.
2. **Formatierung:** Kein Formatter. Der Stil wird über `.editorconfig` und die Konventionen unten festgelegt, der Orchestrator gleicht beim Review an.
3. **Originalseite:** Das Dashboard bekommt einen Schalter, der GitHubs Original-Startseite zeigt. Paket D liefert dafür die Funktion zum Umschalten, Paket H den Schalter in der Oberfläche. Die Wahl gilt nur für die aktuelle Seitenansicht.

### Stil-Konventionen (statt Formatter)

- 2 Leerzeichen Einrückung, Semikolons, einfache Anführungszeichen, Trailing Commas in mehrzeiligen Literalen
- Zeilenlänge bis etwa 100 Zeichen
- Benannte Exporte statt `export default`
- Dateinamen in `kebab-case`, Typen und Klassen in `PascalCase`, Funktionen und Variablen in `camelCase`
- Tests liegen neben dem Code als `<datei>.test.ts`
