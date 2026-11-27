# GitHub UI Enhancer

Browser-Erweiterung für Chrome/Chromium und Firefox, die die Startseite von github.com durch ein konfigurierbares Dashboard ersetzt.

- **Widgets, beliebig oft platzierbar:**
  - Pull Requests (zugewiesen, Review angefragt, selbst erstellt oder eigener Suchfilter)
  - Issues (zugewiesen, beobachtet, selbst erstellt oder eigener Suchfilter)
  - GitHub-Actions-Runs eines Repos mit Branch-Filter
  - Repo-Suche über alle Repositories deines Accounts und aller Organisationen, für die du ein Token hinterlegt hast. Sie läuft lokal ohne Request pro Tastendruck, der Repo-Index wird eine Stunde lang zwischengespeichert. GitHubs eigene Suche mit Strg+K bleibt unberührt.
- **GitHubs Originalseite** bleibt über einen Schalter im Dashboard erreichbar. Der Feed liegt weiterhin unter `/feed`.
- **Tweaks** in den Einstellungen, nach Bereichen gruppiert. Im Bereich „Dashboard“ lässt sich das erweiterte Dashboard komplett abschalten und GitHubs Changelog-Widget ausblenden. Änderungen wirken sofort, auch in offenen Tabs.

Die Daten kommen ausschließlich aus der offiziellen GitHub-API. Die Erweiterung schreibt nie etwas nach GitHub.

## Voraussetzungen

- Chrome/Chromium ab Version 126 oder Firefox ab Version 128
- Zum Bauen: Node.js ab Version 24 und pnpm

## Bauen

```bash
pnpm install
```

```bash
pnpm build
```

Das Ergebnis liegt in `dist/chrome/` und `dist/firefox/`.

## Installieren

### Chrome / Chromium

1. `chrome://extensions` öffnen.
2. Rechts oben den **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** und den Ordner `dist/chrome` wählen.

Nach einem neuen Build in `chrome://extensions` auf das Neuladen-Symbol der Erweiterung klicken und den GitHub-Tab neu laden.

### Firefox

Zum Ausprobieren:

1. `about:debugging#/runtime/this-firefox` öffnen.
2. **Temporäres Add-on laden** und die Datei `dist/firefox/manifest.json` wählen.

Temporäre Add-ons verschwinden beim Beenden von Firefox. Für eine dauerhafte Installation muss die Erweiterung über addons.mozilla.org signiert werden (auch als „unlisted“ für den Eigengebrauch möglich).

Falls Firefox den Zugriff auf `github.com` und `api.github.com` nicht schon bei der Installation gewährt hat: unter `about:addons` bei der Erweiterung den Reiter **Berechtigungen** öffnen und beide Websites erlauben.

## Tokens einrichten

Die Erweiterung braucht **fine-grained Personal Access Tokens mit reinen Leserechten**, und zwar eines pro Account bzw. Organisation. Ein fine-grained Token gilt immer nur für einen „Resource owner“. Classic Tokens werden absichtlich nicht unterstützt, weil sie für private Repos immer auch Schreibrechte haben.

1. Unter [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) ein Token anlegen.
2. **Resource owner:** zuerst dein eigener Account, danach je ein weiteres Token pro Organisation. Erscheint eine Organisation nicht in der Liste, erlaubt sie keine fine-grained Tokens.
3. **Repository access:** All repositories.
4. **Repository permissions**, alle auf **Read-only**:
   - Metadata
   - Contents
   - Pull requests
   - Issues
   - Actions
5. Ein Ablaufdatum setzen. Die Erweiterung warnt 14 Tage vorher.
6. In den Einstellungen der Erweiterung (Rechtsklick auf das Erweiterungssymbol, **Optionen**, oder der Link im Dashboard) das Token einfügen.

Manche Organisationen verlangen, dass ein Admin das Token freigibt. Bis dahin zeigt die Erweiterung den Status „wartet auf Freigabe“.

## Sicherheit und Datenschutz

- **Ablage:** Die Tokens liegen nur in `storage.local` des Browserprofils, nie in `storage.sync`. Sie verlassen den Hintergrundprozess der Erweiterung nicht. Das Skript auf github.com bekommt nur fertige Daten.
- **Nur lesend:** Der API-Client erlaubt ausschließlich lesende Aufrufe und blockiert GraphQL-Mutations, zusätzlich zu den Leserechten der Tokens.
- **Keine Dritten:** Es gibt keine Server und kein Tracking. Netzwerkanfragen gehen nur an `api.github.com`.

## Bekannte Einschränkungen

- **Fehlende Repos:** Repos, in denen du Outside Collaborator einer Orga bist, und Repos anderer Nutzer sind mit fine-grained Tokens nicht erreichbar.
- **Kein Abgleich zwischen Tabs:** Layout-Änderungen aus einem anderen Tab werden erst nach dem Neuladen sichtbar.
- **Abhängig von GitHubs Seitenaufbau:** Ändert GitHub die Struktur der Startseite grundlegend, bleibt die Originalseite stehen, bis der Einhängepunkt angepasst ist.

## Entwicklung

```bash
pnpm check
```

Führt Typecheck, Bindestrich-Prüfung, Tests mit Coverage-Schwellen und den Build aus.

```bash
pnpm watch
```

Baut bei jeder Änderung neu.

```bash
pnpm test:perf
```

Prüft die Zeitbudgets der Repo-Suche.

Arbeitsregeln und Projektentscheidungen stehen in `CLAUDE.md`, Hintergründe in `docs/machbarkeit.md` und `docs/plan.md`.
