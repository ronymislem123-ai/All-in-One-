# Integrationen

## 1. Claude

### 1.1 Machbarkeit (geprüft)

| Weg | Möglich? | Einordnung |
|---|---|---|
| Automatischer Zugriff auf Claude.ai-Projekte/-Unterhaltungen über die Anthropic API | **Nein** | Die API stellt Modelle bereit, keinen Zugriff auf persönliche Claude.ai-Inhalte. OMEGA behauptet so etwas nirgends. |
| **MCP-Server** (Claude Code, Claude Desktop) | **Ja – umgesetzt** | Claude ruft OMEGA-Werkzeuge auf und übermittelt strukturierte Daten. |
| **Ingest-API** (`POST /api/ingest/v1/events`, Bearer-Token) | **Ja – umgesetzt** | Für Skripte, CI, eigene Automationen. |
| **Datei-Import** (JSON/Markdown/Text) | **Ja – umgesetzt** | Für Claude.ai-Chats: Claude erzeugt die Datei/den Text, du importierst sie im Sync Center. |
| **Claude API** für KI-Funktionen | **Optional – umgesetzt** | Nur mit `ANTHROPIC_API_KEY`: Ideengenerierung, Fragen an den Code-Begleiter. Ohne Schlüssel deaktiviert und so gekennzeichnet. |

Die CLI-Syntax für `claude mcp add` stammt aus der offiziellen Claude-Code-Dokumentation (geprüft am 2026-11-06, siehe Wissensartikel „MCP-Server in Claude Code verbinden“).

### 1.2 MCP-Server einrichten

1. In OMEGA: **Einstellungen → Integrationen → Token erzeugen** (Bereiche `ingest`, optional `read`). Das Token wird nur einmal angezeigt.
2. `npm run build:mcp`
3. In Claude Code:
   ```bash
   claude mcp add --transport stdio --env OMEGA_URL=http://127.0.0.1:4317 --env OMEGA_TOKEN=<Token> omega -- node /pfad/zu/omega-infinity/dist/mcp/index.js
   ```
   Für ein ganzes Team-Repository alternativ `--scope project` (Eintrag in `.mcp.json`; Token über Umgebungsvariable einbinden, nie einchecken).

**Werkzeuge:** `omega_status`, `omega_list` (bekannte externalIds), `omega_upsert_project`, `omega_upsert_module`, `omega_report_progress`, `omega_add_idea`, `omega_upsert_doc`, `omega_rename`, `omega_archive`, `omega_send_events` (bis 100 Ereignisse) sowie für die **Werkstatt** `omega_live_start`, `omega_live_log`, `omega_live_milestone`, `omega_live_task`, `omega_live_screenshot`, `omega_live_preview`, `omega_live_status` (siehe 1.5).

Die eventId wird aus dem Inhalt abgeleitet: identische Übermittlungen sind No-ops. Fortschrittsmeldungen sind pro Tag eindeutig.

**Empfohlene Anweisung für Claude (z. B. in `CLAUDE.md` deines Projekts):**
> Melde Strukturänderungen und Fortschritte über die OMEGA-Werkzeuge. Verwende als externalId den Projekt-Slug (z. B. `mein-projekt`) und für Module `mein-projekt/<modul>`. Setze `codePath` auf den Ordner im Repository. Melde „abgeschlossen“ nur als `claude_reported_done`.

### 1.3 Ingest-Format `omega.ingest/v1`

```json
{
  "schema": "omega.ingest/v1",
  "source": { "client": "claude-code", "label": "Mein Repo" },
  "events": [
    { "eventId": "2026-11-06-001", "type": "project.upsert", "data": { "externalId": "mein-projekt", "name": "Mein Projekt", "status": "in_development", "category": "web-apps", "repository": "owner/repo" } },
    { "eventId": "2026-11-06-002", "type": "node.upsert", "data": { "externalId": "mein-projekt/api", "parentExternalId": "mein-projekt", "kind": "module", "name": "API", "nature": "technical", "codePath": "server/src" } },
    { "eventId": "2026-11-06-003", "type": "progress.report", "data": { "externalId": "mein-projekt", "summary": "API fertig", "progress": 40 } }
  ]
}
```

| Typ | Pflichtfelder | Optionale Felder |
|---|---|---|
| `project.upsert` | `externalId`, `name` | `kind` (project/subproject), `parentExternalId`, `summary`, `description`, `status`, `progress`, `category` (Slug), `repository` (`owner/name` → nur **Vorschlag**), `tags` |
| `node.upsert` | `externalId`, `name`, `kind` (subproject/module/submodule/feature/component), `parentExternalId` | `summary`, `description`, `status`, `progress`, `nature`, `codePath`, `category`, `tags` |
| `idea.upsert` | `externalId`, `title`, `summary` | `description`, `problem`, `goal`, `benefit`, `audience`, `category`, `features`, `technologies`, `complexity`, `effort`, `tags` |
| `progress.report` | `externalId`, `summary` | `status`, `progress`, `details` |
| `doc.upsert` | `externalId`, `parentExternalId`, `title`, `body` (Markdown) | – |
| `node.rename` | `externalId`, `name` | – |
| `node.archive` | `externalId` | `reason` |

Statuswerte: `idea`, `planned`, `concept`, `in_development`, `claude_reported_done`, `released`, `unknown`, `unavailable`.

**Antwort:** `{ runId, summary: { applied, duplicate, conflict, rejected, failed }, results: [{ eventId, status, message, entityId, conflictId, issues }] }`.

**Regeln:** gleiche externalId = Aktualisierung (nie Duplikat) · ähnliche Namen = vorläufig separat + Konflikt · unbekanntes Elternobjekt = sicher gespeichert, automatische Zuordnung sobald es eintrifft · auf der Website geänderte Felder werden nicht überschrieben (Konflikt) · Notizen/Priorität/Kategorie-Änderungen bleiben unangetastet · Objekte im Papierkorb werden nicht still wiederbelebt.

### 1.4 Datei-Import

- **JSON** im obigen Format (fehlende eventIds werden aus dem Inhalt erzeugt → Re-Import ohne Duplikate).
- **Markdown** mit Kopfbereich:
  ```markdown
  ---
  omega: project
  externalId: mein-projekt
  name: Mein Projekt
  status: in_development
  category: web-apps
  repository: owner/repo
  ---
  # Mein Projekt

  Beschreibung …

  ## Module
  - Login | in_development
  - Export
  ```
- **Markdown/Text ohne `omega: project`** wird als Idee erfasst.

Vorschau (Dry-Run) ist Pflicht vor dem Import in der Oberfläche.

### 1.5 Werkstatt – Live-Entwicklung mitverfolgen (`omega.live/v1`) <a id="live"></a>

Die Werkstatt (`/live`) zeigt in Echtzeit, was Claude gerade baut. Claude streamt dazu Ereignisse; OMEGA stellt sie nur dar und verändert daraus **keine** Projektdaten.

**Sitzung starten** – `POST /api/ingest/v1/live/sessions` (Bearer-Token mit Bereich `ingest`):
```json
{ "externalId": "mein-projekt/2026-11-06", "title": "Mein Projekt", "goal": "…", "state": "building", "phase": "Backend",
  "milestones": [{ "key": "design", "label": "Design" }, { "key": "frontend", "label": "Frontend" }, { "key": "backend", "label": "Backend" }],
  "tasks": [{ "key": "t1", "title": "Datenmodell", "status": "doing" }] }
```
Gleiche `externalId` = Aktualisierung (Meilensteine/Aufgaben werden zusammengeführt, nie entfernt).

**Ereignisse senden** – `POST /api/ingest/v1/live/sessions/<externalId>/events` mit `{ "events": [ … ] }` (bis 100 je Aufruf, idempotent über `eventId`):

| `kind` | Pflicht | Wirkung |
|---|---|---|
| `log`, `research`, `plan`, `decision`, `build`, `test`, `problem` | `title`, optional `body` | Protokolleintrag (Problem erzeugt zusätzlich eine Benachrichtigung) |
| `milestone` | `milestone: { key, label?, progress?, status? }` | Meilenstein anlegen/aktualisieren (beim ersten Mal `label` nötig) |
| `task` | `task: { key, title?, status?, detail?, order? }` | Aufgabe anlegen/aktualisieren (`todo`, `doing`, `done`, `blocked`) |
| `screenshot` | `image: { mime, base64, caption? }` | Bild speichern (PNG/JPEG/WebP/GIF/SVG, max. 3 MB, dedupliziert) |
| `preview` | `preview: { url, note? }` | Vorschau-Adresse setzen (`url: null` entfernt sie) |
| `status` | `status: { state?, phase?, progress?, now? }` | Zustand (`planning`, `building`, `testing`, `done`, `paused`), Phase, Gesamtfortschritt, „Gerade in Arbeit“ |

**Antwort:** `{ sessionId, summary: { applied, duplicate, rejected }, results: [{ index, eventId, status, message, issues }] }`.

**Ohne MCP:** `scripts/omega-live.mjs` (nur Node, keine Abhängigkeiten) – `OMEGA_URL`, `OMEGA_TOKEN`, `OMEGA_LIVE_ID` setzen, dann z. B. `node scripts/omega-live.mjs log research "Codebasis gelesen" "…"`, `… shot ./bild.png "Startseite"`, `… milestone backend 70`, `… preview http://localhost:5173`, `… status --state done`.

**Empfohlene Anweisung für Claude:**
> Streame deinen Entwicklungsprozess in die OMEGA-Werkstatt: zu Beginn `omega_live_start` mit Ziel, Meilensteinen (design, frontend, backend, datenbank, funktionen, optimierung) und Aufgaben. Danach laufend kurze Protokolleinträge (Recherche, Plan, Entscheidung mit Begründung, Code, Test, Problem), Meilenstein- und Aufgaben-Updates, Screenshots nach jedem sichtbaren Zwischenstand, die Vorschau-Adresse sobald ein Dev-Server läuft und am Ende `omega_live_status` mit `state: done`.

Die Live-Vorschau wird als iframe eingebettet; Server, die Einbettung verbieten (z. B. OMEGA selbst, `frame-ancestors 'none'`), öffnet man über „Öffnen“ in einem neuen Tab.

## 2. GitHub (nur lesend)

- **Berechtigungen:** Fine-grained Personal Access Token mit **Metadata: Read** und **Contents: Read** für die gewünschten Repositories. Ohne Token funktionieren öffentliche Repositories (60 Anfragen/Stunde).
- **Token-Speicher:** bevorzugt `GITHUB_TOKEN` (Umgebung); alternativ in den Einstellungen – AES-256-GCM-verschlüsselt, nie an den Browser zurückgegeben.
- **Webhook (optional):** Payload-URL `<OMEGA_PUBLIC_URL>/api/webhooks/github`, Content type `application/json`, Secret = `GITHUB_WEBHOOK_SECRET` (oder in den Einstellungen), Ereignisse `push`, `repository`. Ohne Secret lehnt OMEGA Webhooks ab.
- **Polling:** Standard alle 30 Minuten (einstellbar); nicht veränderte Repos kosten dank ETag kein Kontingent.
- **Branch:** Standardbranch oder ein gewählter Branch je Repository (Code Explorer → Branch-Auswahl).
- **Grenzen:** sehr große Repositories (Tree gekürzt oder Archiv > 80 MB) werden unvollständig dargestellt und entsprechend gekennzeichnet. Inhalte werden nicht dauerhaft gespeichert, sondern bei Bedarf geladen und im Speicher zwischengespeichert.
