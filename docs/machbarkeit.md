# Machbarkeitsanalyse: GitHub-Startseite mit eigenen Widgets

Stand: 2026-11-26

## Ergebnis

**Machbar, ohne harte Blocker.** Alle gewünschten Widgets lassen sich über dokumentierte GitHub-APIs abbilden.
Die Erweiterung braucht aber **zwingend ein Token**: Die GitHub-Session auf github.com lässt sich für `api.github.com` nicht verwenden.

**Entscheidung (2026-11-26): ausschließlich fine-grained PATs mit reinen Leserechten**, eines pro Resource Owner (persönlicher Account und jede Orga). Classic PATs werden nicht unterstützt, weil sie für private Repos immer auch Schreibrechte haben.

Die drei echten Risiken:

1. **Organisations-Richtlinien zu Tokens.** Eine Org muss fine-grained Tokens erlauben und gibt sie eventuell erst nach Admin-Freigabe frei. Das kann die Erweiterung nicht umgehen.
2. **Kopplung an das GitHub-DOM.** Das Einhängen auf `/` hängt an GitHubs Markup und an der SPA-Navigation. Das bedeutet gelegentliche Wartung, ist aber kein Blocker.
3. **Abdeckungslücken und Aufwand durch mehrere Tokens.** Repos als Outside Collaborator und Repos anderer Nutzer sind mit fine-grained Tokens nicht erreichbar. Außerdem muss die Datenschicht globale Abfragen über alle Tokens verteilen und die Ergebnisse zusammenführen (siehe Abschnitt 1 und 7).

---

## 1. Authentifizierung: Geht es ohne PAT?

**Nein.**

- `api.github.com` akzeptiert nur Token-Authentifizierung. Das Session-Cookie von github.com gilt dort nicht. Ohne Token sind nur unauthentifizierte Aufrufe möglich: 60 Requests pro Stunde, keine privaten Repos.
- CORS ist kein Hindernis. Die REST-API erlaubt Cross-Origin-Aufrufe von jedem Origin, auch mit `Authorization`-Header ([Docs](https://docs.github.com/en/enterprise-cloud@latest/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)).
- **Refined GitHub** (der Referenzfall) macht es genauso: `fetch` direkt auf `api.github.com` mit `Authorization: token <PAT>` aus den Optionen. Ohne Token läuft die Erweiterung unauthentifiziert ([Quellcode `source/github-helpers/api.tsx`](https://github.com/refined-github/refined-github/blob/main/source/github-helpers/api.tsx)).
- Theoretisch könnte man GitHubs interne Endpunkte auf github.com nutzen (die React-UI arbeitet mit Session-Cookie). Die sind aber undokumentiert, ändern sich ohne Ankündigung und sind rechtlich eine Grauzone. **Verworfen.**

### Welcher Token-Typ?

| Option | Mehrere Orgs | Lesezugriff möglich | Org-Admin nötig | Bewertung |
|---|---|---|---|---|
| Classic PAT (`repo`, `read:org`) | ja, ein Token für alles | nein, `repo` schließt Schreiben ein | nur bei SSO: einmal „Configure SSO“ pro Org | verworfen: keine Leserechte-Beschränkung |
| **Fine-grained PAT** | **nein**, nur ein Resource Owner pro Token ([Docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)) | ja | ggf. Freigabe pro Org | **gewählt:** ein Token pro Owner, Ergebnisse zusammenführen |
| OAuth App (Device Flow) | ja | nein | **ja**, OAuth-App-Zugriffsbeschränkungen sind bei neuen Orgs standardmäßig aktiv ([Docs](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/about-oauth-app-access-restrictions)) | zu viel Reibung |
| GitHub App (User Token) | nur dort, wo die App installiert ist | ja | ja, Installation pro Org | passt nicht zu „alle Orgs ohne Admin“ |

### Gewählt: fine-grained PATs, read-only, eines pro Resource Owner

Berechtigungen pro Token, alle nur **read**:

| Berechtigung | Wofür |
|---|---|
| Metadata | Repo-Liste (Pflicht, wird automatisch gesetzt) |
| Contents | Branches für den Actions-Filter |
| Pull requests | PR-Widgets |
| Issues | Issue-Widgets |
| Actions | Workflow-Runs |
| Org: Members (nur Org-Tokens, optional) | Team-Bezug, z. B. für Review-Anfragen an Teams |

Repository access: **All repositories** des jeweiligen Owners.

Folgen der Entscheidung:

- **Setup:** Der Nutzer legt ein Token für den persönlichen Account und je eines pro Orga an. Eine Orga erscheint im Dropdown „Resource owner“ nur, wenn sie fine-grained Tokens erlaubt. Eventuell muss ein Org-Admin das Token freigeben, bis dahin ist es „pending“ ([Docs](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)).
- **SSO:** Fine-grained Tokens werden bei der Erstellung für SSO autorisiert, ein separater Schritt entfällt.
- **Ablauf:** Fine-grained Tokens laufen spätestens nach einem Jahr ab, Orgas können kürzere Laufzeiten erzwingen. Die Erweiterung liest das Ablaufdatum aus dem Response-Header `github-authentication-token-expiration` und warnt rechtzeitig (Header-Name am echten Token prüfen).
- **Abdeckungslücken:** Nicht erreichbar sind Repos, in denen der Nutzer Outside Collaborator einer Orga ist (laut Docs nur mit Classic PAT), und Repos anderer Nutzer, in denen er Collaborator ist. Öffentliche Repos sind für jedes fine-grained Token lesbar.
- **Mehr Requests:** Globale Abfragen (Repo-Liste, Suche, abonnierte Issues) laufen einmal pro Token. Alle Tokens desselben Nutzers teilen sich dessen Rate-Limit. Gegenmaßnahmen stehen in Abschnitt 7.
- Classic PATs werden **nicht abgeschaltet**, es gibt kein Sunset-Datum. GitHub empfiehlt aber fine-grained Tokens und baut GitHub Apps aus ([Changelog 2026-10-13](https://github.blog/changelog/2026-10-13-github-app-improvements-for-least-privilege-and-management/)). Die Entscheidung liegt also auch auf GitHubs Linie.

### Ablage und Validierung der Tokens

- Die Tokens werden auf der Options-Seite als Liste eingegeben und in `storage.local` gespeichert, **nie in `storage.sync`**. Pro Eintrag gibt es:
  - Token (nach dem Speichern nur maskiert sichtbar)
  - Resource Owner: Die Erweiterung ermittelt ihn aus den Ownern in `GET /user/repos`, der Nutzer kann ihn manuell korrigieren.
  - Status: gültig / pending / abgelaufen / ungültig, plus Ablaufdatum
- Beim Speichern prüft die Erweiterung:
  - `GET /user`: Der Login muss zum angemeldeten github.com-Nutzer passen (wie Refined GitHub).
  - Fehlende Berechtigungen erkennt sie an `403 Resource not accessible by personal access token` beim ersten Aufruf des jeweiligen Endpunkts und zeigt einen Hinweis an.
- **Die Tokens bleiben im Background-Kontext.** Content Scripts schicken Anfragen per Messaging an den Background. Der Background wählt das passende Token und ruft die API auf. Das Content Script und damit die Seite sieht kein Token.
- **Defense in depth:** Der API-Client erlaubt nur `GET` und GraphQL-Queries ohne `mutation`. Das schützt vor Bugs, die eigentliche Absicherung sind die Leserechte der Tokens.
- `storage.local` ist nicht verschlüsselt, die Tokens liegen im Klartext im Browserprofil. Eine Verschlüsselung ohne Benutzergeheimnis bringt keine echte Sicherheit. Wer lokal Zugriff hat, besitzt ohnehin das github.com-Session-Cookie und den SSH-Key. Die Absicherung erfolgt deshalb über Leserechte, Ablaufdatum und Isolation im Browser.

---

## 2. Widgets: API-Abdeckung

Rate-Limits ([Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)):

- REST: 5000 Requests pro Stunde
- GraphQL: 5000 Punkte pro Stunde
- Search-Endpunkte (REST): **30 Requests pro Minute**
- Bedingte Requests mit ETag, die `304` liefern, zählen nicht gegen das Limit.

Aktuelle REST-Version: `2026-03-10`.

Mit fine-grained Tokens gibt es zwei Arten von Abfragen:

- **Global** (Repo-Liste, Suche, abonnierte Issues): läuft **einmal pro Token**. Die Ergebnisse werden zusammengeführt und über die Node-ID dedupliziert, denn PRs in öffentlichen Repos können mehrere Tokens zurückliefern.
- **Repo-bezogen** (Actions-Runs, Branches): läuft nur mit dem Token, dessen Resource Owner dem Repo-Owner entspricht. Gibt es keins, nimmt die Erweiterung bei öffentlichen Repos ein beliebiges Token, sonst zeigt sie den Hinweis „kein Token für Owner X“.

| Widget | Endpunkt | Anmerkungen |
|---|---|---|
| **Orga-übergreifende Repo-Suche** | `GET /user/repos?per_page=100` pro Token, mit Paginierung über den `Link`-Header ([Docs](https://docs.github.com/en/rest/repos/repos)) | Jedes Token liefert die Repos seines Owners. Bei 3000 Repos sind das insgesamt etwa 30 Requests, einmal pro Stunde. Der Cache speichert nur die nötigen Felder (`full_name`, `description`, `private`/`visibility`, `archived`, `fork`, `pushed_at`, `html_url`). Die Suche läuft clientseitig als Fuzzy-Suche. Der Index merkt sich außerdem, welches Token zu welchem Repo gehört, für das Routing der repo-bezogenen Abfragen. |
| **Assigned PRs** | GraphQL `search(type: ISSUE, query: "is:pr is:open assignee:@me archived:false")` | GraphQL liefert in einem Request auch `reviewDecision`, CI-Status (`statusCheckRollup`), Draft-Status und Labels. Der REST-Weg über `/search/issues` braucht pro PR Folge-Requests für Status und Reviews. |
| **Reviewer PRs** | dito, `review-requested:@me` (optional zusätzlich `reviewed-by:@me`) | |
| **Created PRs** | dito, `author:@me` | |
| **Assigned Issues** | dito, `is:issue is:open assignee:@me` | Alternativ `GET /issues?filter=assigned`, ohne Search-Limit |
| **Watched Issues** | `GET /issues?filter=subscribed` ([Docs](https://docs.github.com/en/rest/issues/issues)) | Gilt über alle sichtbaren Repos, auch in Orgs. Die Antwort enthält auch PRs, sie lassen sich am Feld `pull_request` herausfiltern. **Offene Frage:** siehe Abschnitt 7. |
| **Actions-Runs mit Branch-Filter** | `GET /repos/{o}/{r}/actions/runs?branch=…&per_page=…` ([Docs](https://docs.github.com/en/rest/actions/workflow-runs)), dazu `GET /repos/{o}/{r}/branches` für die Branch-Auswahl | Die Repo-Auswahl nutzt den gecachten Repo-Index der Suche. Benötigt die Berechtigungen „Actions: read“ und „Contents: read“ auf dem Token des Repo-Owners. Polling nur, solange der Tab sichtbar ist, mit ETag. |

Das Budget bleibt unkritisch, wächst aber mit der Zahl der Tokens. Ein Beispiel:

- 5 Tokens
- 6 Widget-Instanzen, davon 5 Such-Widgets, alle 5 Minuten aktualisiert

Ohne Bündelung sind das 25 Suchanfragen pro Durchlauf. Die Datenschicht bündelt deshalb alle Such-Widgets eines Durchlaufs per GraphQL-Aliasing in **eine Query pro Token**. Das ergibt 5 Requests pro Durchlauf, also etwa 60 pro Stunde. Hinzu kommen der Repo-Index (stündlich) und die Actions-Abfragen. Das liegt weit unter den Limits. Wenn mehrere Instanzen dieselbe Abfrage verwenden, holt die Datenschicht sie nur einmal.

**Grenze der Suche:** Gefunden werden alle Repos der Owner, für die ein Token hinterlegt ist. Nicht enthalten:

- Repos, in denen der Nutzer Outside Collaborator ist, und Repos anderer Nutzer (Einschränkung fine-grained PAT)
- Repos von Orgas, die fine-grained Tokens nicht erlauben oder das Token noch nicht freigegeben haben
- beliebige öffentliche Repos. Sie lassen sich optional über die GitHub-Repo-Suche als zweite Ergebnisgruppe ergänzen.

---

## 3. Einhängen in github.com

- Seit dem **01.10.2026** ist GitHubs neues Dashboard der Standard. Unter `/` liegen Home-Listen (Agents, PRs, Issues), der Feed ist nach `/feed` umgezogen ([Changelog](https://github.blog/changelog/2026-10-01-new-dashboard-experience-now-the-default/)). Das ist das Dashboard, das ersetzt werden soll.
- Das Content Script braucht den Match `https://github.com/*`, nicht nur `/`. GitHub navigiert als SPA (Turbo bzw. React Soft-Navigation). Content Scripts werden dabei nicht neu ausgeführt, etwa wenn man auf das Logo klickt ([Beispielprojekt](https://awesome.ecosyste.ms/api/v1/projects/github.com%2Fmcomella%2Fgithub-content-script-navigation)).
- Ablauf:
  1. Bei `document_start` per CSS das Original-Dashboard ausblenden, solange `location.pathname === '/'` und der Nutzer angemeldet ist (`meta[name="user-login"]`). Das verhindert ein Aufblitzen der Originalseite.
  2. Den eigenen Container unter dem Header einhängen.
  3. Auf Navigationen reagieren: Turbo-Events, `popstate`, gepatchtes `history.pushState` und ein `MutationObserver` als Fallback.
- Die Kopplung ans DOM bleibt bewusst minimal. Die Erweiterung braucht nur zwei Dinge: „ist Startseite + eingeloggt“ und einen Mount-Punkt. Ändert GitHub das Markup, muss man nur diese eine Stelle anpassen.

---

## 4. Styling

- **Primer CSS** (`@primer/css`) ist im KTLO-Modus („Keep the Lights On“). GitHub selbst setzt auf Primer React mit CSS-Modules ([Diskussion](https://github.com/primer/view_components/discussions/3908)). Klassische Utility-Klassen wie `Box`, `Label` oder `color-fg-muted` existieren auf github.com zwar noch, GitHub entfernt aber schrittweise ungenutztes CSS. **Darauf sollte man sich nicht verlassen.**
- **Stabil sind die Primer-Primitives** als CSS-Variablen (`--fgColor-default`, `--bgColor-muted`, `--borderColor-default`, `--base-size-8` usw.). github.com lädt sie, und sie folgen automatisch dem Light-, Dark- oder High-Contrast-Theme des Nutzers.
- **Empfehlung:**
  - eigenes, schlankes CSS mit Präfix (z. B. `ghx-`), das nur Primer-Variablen nutzt
  - wenige hart kodierte Fallback-Werte in `var(--fgColor-default, #1f2328)`, keine Abhängigkeit auf `@primer/primitives`
  - die benötigten Octicons (etwa zehn) als SVG-Pfade direkt im Code, mit MIT-Lizenzhinweis, statt `@primer/octicons` als Paket
  - Das Ergebnis sieht nativ aus und hat Dark Mode ohne Zusatzaufwand.
- **Bootstrap wird nicht empfohlen.** Es würde mit GitHubs globalem CSS kollidieren (Reset, Typografie) und fremd aussehen. Shadow DOM würde zwar isolieren, schneidet aber auch die Primer-Variablen nicht ab (CSS-Variablen vererben sich in den Shadow Tree). Das ist eine Option, falls GitHub-CSS später in die Widgets durchschlägt.

---

## 5. Cross-Browser (Chrome und Firefox)

- Ein gemeinsames MV3-Manifest ist möglich. Chrome verlangt `background.service_worker`, Firefox kennt nur `background.scripts` (Event Page). Ab Chrome 121 und Firefox 121 wird der jeweils fremde Key ignoriert ([MDN](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)).
- **Vorgabe: so wenige Libraries wie möglich, TypeScript.** Deshalb kein Framework wie WXT oder Plasmo und kein `webextension-polyfill`. Chrome und Firefox unterstützen in MV3 beide den Namespace `chrome.*` mit Promises. Ein kleines Build-Skript bündelt mit esbuild und schreibt zwei Manifeste (`dist/chrome`, `dist/firefox`), die sich nur im `background`-Key und in `browser_specific_settings` unterscheiden.

| Paket | Art | Zweck |
|---|---|---|
| `typescript` | dev | Typecheck (`tsc --noEmit`), strict |
| `esbuild` | dev | Bundling von Background, Content Script und Options-Seite, ohne eigene Abhängigkeiten |
| `@types/chrome` | dev | Typen für die Extension-API |

**Keine Runtime-Abhängigkeiten.** Selbst geschrieben werden:

- UI: Vanilla TS mit einem kleinen `h()`-Helper für DOM-Elemente, kein Preact
- Fuzzy-Suche für Repos (Präfix-, Teilstring- und Subsequenz-Treffer mit einfacher Gewichtung)
- Cache, Messaging, API-Client

Tests laufen mit dem eingebauten Test-Runner von Node (`node --test`, Node ab 23.6 entfernt TS-Typen nativ). Damit entfallen Vitest und Jest. Optional kommt `web-ext` für Firefox-Signierung und Linting dazu, per `npx` statt als feste Abhängigkeit.
- Benötigte Permissions:
  - `storage` und `unlimitedStorage` (das Chrome-Limit von 10 MB für `storage.local` ist mit großem Repo-Index knapp)
  - `host_permissions`: `https://api.github.com/*`
  - Content Script auf `https://github.com/*`
- Distribution:
  - Firefox: dauerhafte Installation nur signiert, auch für den Eigengebrauch über AMO „unlisted“.
  - Chrome: entpackt im Entwicklermodus oder über den Web Store.

---

## 6. Ähnliche Projekte

Es gibt keine fertige Lösung mit konfigurierbaren, mehrfach platzierbaren Widgets auf der GitHub-Startseite. Die Entscheidung „make“ ist damit begründet.

| Projekt | Was es tut | Nutzen als Vorlage |
|---|---|---|
| [Refined GitHub](https://github.com/refined-github/refined-github) | Große Erweiterung (Chrome, Firefox), PAT optional, ruft die API direkt aus dem Content Script auf | Muster für Token-Validierung, SSO- und Policy-Fehlermeldungen, SPA-Erkennung (`github-url-detection`) |
| [GitHub Dashboard+](https://github.com/aminefourari/github-dashboard-plus) | Ersetzt das Dashboard per Content Script, PAT, eigenes CSS | Gleicher Ansatz, aber nur für Chrome, nicht konfigurierbar, kaum gepflegt (2 Commits) |
| [github-pr-dashboard](https://github.com/internetblacksmith/github-pr-dashboard) | PR-Dashboard als New-Tab-Seite, PAT, 10 Minuten Cache, Chrome und Firefox | Cache-Muster „stale while revalidate“ mit Fehlerbanner |
| [gh-dash](https://dlvhdr.github.io/gh-dash/configuration) | TUI-Dashboard, Abschnitte über GitHub-Suchfilter definiert | **Konfigurationsmodell:** ein generisches „PR-/Issue-Listen-Widget mit Suchfilter“ statt fünf festen Widgets |
| GitHubs neues Dashboard | PR-, Issue- und Agent-Listen, seit 10/2026 Standard | Fest verdrahtet, nicht konfigurierbar, keine Repo-Suche und keine Actions |
| [PR Radar](https://www.deployhq.com/features/pr-radar) | PR-Popup für mehrere Hoster | Anderer Ansatz (Popup) |

---

## 7. Architekturskizze

```text
Options-Seite ──(Token-Liste, Einstellungen)──▶ storage.local
                                              │
Background (SW / Event Page)                  ▼
  ├─ TokenRegistry  Tokens mit Owner, Status, Ablaufdatum
  ├─ Router         global → alle Tokens + Merge/Dedupe; repo-bezogen → Token des Owners
  ├─ GitHubClient   REST + GraphQL, nur lesend, ETag, Rate-Limit-Tracking,
  │                 GraphQL-Bündelung pro Token und Durchlauf
  ├─ Cache          IndexedDB/storage.local, TTL pro Key (Repo-Index: 1 h)
  └─ Message-API    { op: 'rest'|'graphql'|'repoIndex', key, ttl, ... }
                                              ▲
Content Script (github.com/*)                 │ runtime messaging
  ├─ Mount-Logik    Startseite erkennen, Original ausblenden, Container einhängen
  ├─ Widget-Host    Layout aus storage.sync, Instanzen erzeugen und zerstören
  └─ Widgets        nur über WidgetContext → kein direkter Zugriff auf Token oder fetch
```

So könnte die Widget-API aussehen (Entwurf):

```ts
interface WidgetDefinition<C> {
  type: string;                 // 'pr-list', 'issue-list', 'actions-runs', 'repo-search'
  title: string;
  singleton?: boolean;          // true nur für die Suche
  defaultConfig: C;
  configForm(ctx: WidgetContext, config: C): Element; // Einstellungen pro Instanz
  mount(el: HTMLElement, ctx: WidgetContext, config: C): () => void; // gibt dispose zurück
}

interface WidgetContext {
  data: {
    graphql<T>(query: string, vars?: object, opts?: { ttl?: number }): Promise<T>;
    rest<T>(path: string, opts?: { ttl?: number }): Promise<T>;
    repoIndex(): Promise<RepoSummary[]>;
  };
  saveConfig(patch: Partial<C>): Promise<void>;
  onRefresh(cb: () => void): void;   // global oder Intervall
}
```

- **Mehrfachinstanzen:** Das Layout ist eine Liste `{ id, type, config }`. Nur `singleton`-Typen (die Suche) sind einmalig und fest oben.
- **Abgleich mit der Wunschliste:** „assigned / reviewer / created PRs“ und „assigned / watched issues“ sind fünf Presets von zwei generischen Widget-Typen (`pr-list`, `issue-list`). Das hält den Code klein und erlaubt eigene Filter wie `org:foo label:bug`.
- **UI-Technik:** Vanilla TypeScript ohne Framework (siehe Abschnitt 5).

### Offene Fragen

1. **„Watched Issues“:** Sind abonnierte Issues gemeint (`filter=subscribed`, günstig) oder alle Issues in beobachteten Repos (`/user/subscriptions` und dann pro Repo, teuer)? Empfehlung: abonnierte Issues.
2. **Bisherige Startseite:** Soll sie per Toggle oder Link erreichbar bleiben? Der Feed liegt ohnehin unter `/feed`.
3. **Orga-Richtlinien:** Bei welchen der eigenen Orgas sind fine-grained Tokens erlaubt, und brauchen sie eine Admin-Freigabe? Das lässt sich im Dropdown „Resource owner“ beim Anlegen eines Tokens prüfen.
4. **Mit echten Tokens verifizieren:** den Header für das Ablaufdatum, das Verhalten von `GET /issues?filter=subscribed` und der GraphQL-Suche mit fine-grained Tokens sowie die Abdeckung von Enterprise-`internal`-Repos.
