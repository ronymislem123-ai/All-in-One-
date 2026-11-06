# Architektur – OMEGA Infinity

## 1. Produktgrenzen

| System | Rolle | OMEGA darf |
|---|---|---|
| **Claude** | Entwicklungs- und Ideenumgebung | strukturierte Informationen **empfangen**, die Claude aktiv übermittelt (MCP, API, Datei). Kein Zugriff auf Claude.ai-Unterhaltungen/Projekte. |
| **GitHub** | Quelle der tatsächlichen Codebasis | **nur lesen**, lokal spiegeln, analysieren, visualisieren. Keine Schreiboperationen (der Client implementiert ausschließlich `GET`). |
| **Website (OMEGA)** | Kontrollzentrum | Organisation, Verwaltung, Synchronisierung, Backups, Darstellung. **Keine IDE.** |

## 2. Technologie

- **Server:** Node.js 22, TypeScript, [Hono](https://hono.dev) (HTTP), better-sqlite3 (SQLite 3.53, WAL, `synchronous=FULL`, FTS5), Zod (Validierung), `@anthropic-ai/sdk` (optional), tar-stream.
- **Web:** React 19, React Router 8, TanStack Query (Server-State), TanStack Virtual (große Listen), @xyflow/react + dagre (Code-Graph), highlight.js (lesende Codeansicht), react-markdown (ohne HTML-Rendering), lucide-react, Geist-Schriften (lokal, keine externen Requests).
- **MCP-Server:** `@modelcontextprotocol/sdk`, stdio-Transport.
- **Tests:** Vitest (Server, inkl. GitHub-Mock und echtem MCP-stdio-Prozess), Playwright + axe-core (Browser, WCAG 2.1 AA).

Begründungen siehe [DECISIONS.md](DECISIONS.md).

## 3. Verzeichnisstruktur

```
shared/src/        Gemeinsames Vokabular: Objekttypen, drei Statusachsen, Konflikttypen, Ingest-Schema omega.ingest/v1
server/src/
  config.ts        Umgebungsvariablen → typisierte Konfiguration
  bootstrap.ts     DB öffnen → Migration (mit Sicherung vorab) → Seeds → Suchindex
  app.ts           HTTP: Sicherheitsheader, Identität, CSRF, Default-Deny, Fehlerbehandlung, statische Web-App
  http/            Routen (core, domain, sync) + Hilfen
  auth/            Konto, Sitzungen, API-Tokens, Rate-Limits
  db/              Verbindung (austauschbar für Restore), Migrationen mit Prüfsummen
  modules/         Fachlogik (siehe 4.)
  modules/github/  client (read-only), sync, analyzer, explorer, webhook, repos, code-ai
  jobs/            Scheduler (Backups, GitHub-Polling)
  seed/            Kategorien, 144 Ideen, 18 Wissensartikel (JSON), Demo-Daten
web/src/
  design/          Tokens (Dark/Light/Dichte/Bewegung) + Komponenten-CSS
  components/      UI-Bausteine, Layout (Shell, Command Palette, Logo)
  features/        Seiten je Bereich (dashboard, projects, apps, ideas, knowledge, sync, conflicts, code, activity, backup, settings, auth)
mcp/src/           MCP-Server für Claude Code / Claude Desktop
e2e/               Playwright-Tests
```

## 4. Module (Verantwortlichkeiten)

| Modul | Verantwortung |
|---|---|
| `nodes` | Hierarchie aller Projekt-Objekte (Projekt, Unterprojekt, Modul, Untermodul, Funktion, Komponente, Dokumentation, Referenz, Information), unbegrenzte Tiefe, Zyklenschutz, Feld-Herkunft, Versionen, Papierkorb, Code-Status |
| `apps` | App Library, Verfügbarkeitsnachweis (SSRF-geschützte Prüfung, interne Routen, manuelle Bestätigung für Desktop) |
| `ideas` / `ideas-ai` | Ideenbibliothek, 14 lokale Entdeckungsmodi, Duplikat-/Variantenerkennung, Entwicklungsauftrag, Idee→Projekt; optional Claude-API-Generierung |
| `knowledge` | Claude Knowledge Hub mit Quellen und Prüfdatum |
| `categories`, `tags` | Gemeinsame, datenbankverwaltete Taxonomie |
| `ingest` | Claude-Pipeline `omega.ingest/v1` (Validierung, Idempotenz, Identitäten, Quellenregeln, Konflikte) |
| `conflicts` | Konfliktregister + Entscheidungen (protokolliert) |
| `github/*` | Read-only-Client, Sync, Tarball-Analyse, Graph/Erklärungen, Webhook, Zuordnungsvorschläge |
| `backup` | Sicherung, Verifikation, Verschlüsselung, externe Kopie, Aufbewahrung, Voll-/Projektwiederherstellung |
| `transfer` | Export/Import der Verwaltungsdaten, Datei-Import (JSON/Markdown/Text) |
| `dashboard` | Kennzahlen, Projektgesundheit, Datenqualität, Integrationsstatus, Empfehlungen |
| `activity`, `notifications`, `search`, `settings`, `sync-log` | Querschnittsfunktionen |

Module rufen sich über klar benannte Funktionen auf; es gibt keinen globalen Zustand außer dem Kontextobjekt `Ctx` (Konfiguration, DB, Logger, Hooks).

## 5. Datenmodell (SQLite)

Zentrale Tabellen (Migration `001_init`, `002_tracked_branch`):

- `nodes` – alle Projekt-Objekte (Adjazenzliste `parent_id`, `ON DELETE RESTRICT`, `CHECK parent_id <> id`), drei Statusachsen, `nature` (organisatorisch/technisch), `code_path`, `field_sources` (JSON: welches Feld zuletzt von Website/Claude kam), `review_state`, `version` (optimistische Sperre), `archived_at`, `deleted_at`.
- `applications`, `ideas`, `knowledge_articles`, `categories`, `tags`/`entity_tags`, `attachments` (Bilder als BLOB → Teil jedes Backups).
- `external_identities` – `(source, entity_type, external_id)` eindeutig → stabile Zuordnung externer IDs (Claude) zu internen IDs.
- GitHub-Spiegel: `repositories` (stabile `github_id`), `repo_branches`, `repo_commits`, `repo_tree`, `code_files` (Imports/Exporte/Rolle, **keine Inhalte**), `code_analyses`, `repo_dependencies`.
- `project_repository_links` – `confirmed` | `suggested` | `rejected`.
- Protokolle: `sync_runs`, `sync_events` (eindeutig `(source, event_id)` → Idempotenz), `conflicts`, `activity`, `entity_versions` (vollständiger Schnappschuss je Version), `notifications`.
- System: `users`, `sessions` (nur Token-Hash), `api_tokens` (Hash), `preferences`, `settings`, `secrets` (AES-256-GCM), `http_cache` (ETags), `meta`.
- Suche: FTS5 `search_index` (Diakritika-unabhängig, Präfixindex).

**IDs:** zeitlich sortierbare ULIDs mit Typpräfix (`nd_…`, `idea_…`, `repo_…`) – nie Namen.

## 6. Quellenwahrheit und Datentrennung

| Information | Maßgebliche Quelle | Umsetzung |
|---|---|---|
| Ideen, fachliche Beschreibungen, geplante Funktionen, Fortschrittsmeldungen | Claude (übermittelt) | `ingest` schreibt in diese Felder, solange die Website sie nicht selbst geändert hat |
| Notizen, Prioritäten, Favoriten, Kategorien, Projektstruktur, Zuordnungen | Website | werden von Claude **nie** überschrieben; Claude-Positionsänderungen nach manueller Verschiebung → Konflikt |
| Code, Dateien, Struktur, Branches, Commits | GitHub | nur gespiegelt; Code-Status (`detected`/`missing`/`unreachable`) wird **abgeleitet**, nie manuell gesetzt |
| Technische Verifikation | Owner mit Nachweis | eigene Statusachse `verification_status` + Notiz |

Drei **getrennte Statusachsen** (nie vermischt): Lebenszyklus (Idee … „Von Claude als abgeschlossen beschrieben“ … Veröffentlicht), Code-Status (aus GitHub abgeleitet), Prüfstatus (technisch geprüft / funktional getestet).

**Datenerhalt:** Repository gelöscht → Projekt, Verknüpfung und Spiegeldaten bleiben, Konflikt `repo_unreachable`. Projekt gelöscht → nur Papierkorb, Repository unberührt. Externe Ausfälle verändern keine gespeicherten Daten.

## 7. Claude-Ingest-Ablauf (omega.ingest/v1)

```
Umschlag validieren → je Ereignis:
  Schema prüfen (Zod) ──fehlerhaft──► sync_event "rejected" (mit Problemen), nichts gespeichert
  Idempotenz: (source,eventId) bekannt?  gleicher Inhalt ► "duplicate" (No-op) | anderer Inhalt ► "rejected"
  Identität auflösen: externalId → interne ID
     unbekannt: Rang 3 – bestätigtes Repository (repository-Hinweis) ► Identität binden
                sonst neu anlegen; ähnliche Geschwister-Namen ► review_state=possible_duplicate + Konflikt
                Eltern-ID unbekannt ► sicher auf oberster Ebene speichern + Konflikt "unresolved_parent" (wait_key)
     bekannt:   Felder nach Quellenregeln aktualisieren; website-geänderte Felder ► Konflikt "field_conflict"
  in einer Transaktion anwenden ► Version + Aktivität + Suchindex
  Ergebnis protokollieren (applied | conflict | rejected | failed) → Antwort an Claude
```

Wird ein wartendes Elternobjekt später übermittelt, ordnet OMEGA die wartenden Einträge **über die externe ID** (nicht über Namen) automatisch zu. Fehlgeschlagene/abgelehnte Ereignisse lassen sich im Sync Center wiederholen.

## 8. GitHub-Ablauf

1. **Erkennung:** mit Token `/user/repos` (paginiert), sonst manuell `owner/name`.
2. **Abgleich:** Metadaten (ETag-Cache → 304 kostet kein Kontingent), Sprachen, Branches, letzte 30 Commits, rekursiver Tree (nur bei neuem Head). Folgt dem Standardbranch oder einem gewählten Branch (`tracked_branch`).
3. **Analyse:** ein Tarball-Download je Commit (statt einer Anfrage pro Datei), Analyse im Speicher mit Limits (80 MB Archiv, 512 KB je Datei). Erkennt Imports/Exporte (TS/JS/Vue/Svelte/Python/Go/Rust/Java/Kotlin/CSS/Ruby/C/PHP), löst relative Imports und `tsconfig`-Aliase auf, liest Manifeste (npm, PyPI, Go, Cargo, Composer, RubyGems). Geheimnis-Dateien werden ausgeschlossen. Rollen (Frontend/Backend/…) sind **Heuristiken** und werden als „vermutet“ angezeigt.
4. **Webhook:** HMAC-SHA256-Signatur Pflicht, Idempotenz über `X-GitHub-Delivery`, löst nur einen lesenden Abgleich aus.
5. **Polling:** Scheduler, Intervall konfigurierbar; Rate-Limit-Stopp bis Reset; Retries mit Backoff für 5xx/sekundäre Limits.
6. **Zuordnung:** stabile `github_id`; Umbenennungen werden erkannt. Namensähnlichkeit erzeugt nur Vorschläge; mehrdeutige Treffer → Konflikt `repo_ambiguous`.

## 9. Backup & Wiederherstellung

- **Ereignisbasiert:** jede Änderung wird in einer Transaktion mit `synchronous=FULL` geschrieben (Bestätigung erst nach dauerhafter Speicherung) und als Version + Aktivität protokolliert.
- **15-Minuten-Zwischenstände:** Scheduler prüft `data_version`; nur bei Änderungen entsteht ein Snapshot (keine redundanten Kopien).
- **Sicherung:** SQLite-Online-Backup → `integrity_check` → optional AES-256-GCM (Schlüssel per scrypt aus Passphrase) → SHA-256 → Metadaten-Sidecar (`*.json`) → optionale **externe Kopie** (mit Prüfsummenvergleich).
- **Aufbewahrung:** alles der letzten 24 h, dann 1/Tag (30 Tage), 1/Woche (12 Wochen); Sicherheitssicherungen 90 Tage; die neueste verifizierte Sicherung wird nie gelöscht.
- **Vollständige Wiederherstellung:** Prüfung → Sicherung des aktuellen Stands → Datei tauschen → Migration → Integritätsprüfung; bei Fehler automatisches Zurückrollen. Zugangsdaten (Konto, Sitzungen, Tokens, Geheimnisse, Einstellungen) bleiben erhalten.
- **Projektwiederherstellung:** einen Projekt-Teilbaum aus einer Sicherung zurückholen, ohne andere Daten zu verändern (vorher Sicherung).
- **Versionshistorie** je Objekt mit Zurücksetzen; **Papierkorb** für Projekte/Ideen/Apps.
- Sicherungs-Metadaten liegen **neben** den Dateien (nicht in der Datenbank) – eine wiederhergestellte DB kann die Backup-Liste nicht verfälschen.

## 10. Sicherheit

Siehe [SECURITY.md](SECURITY.md). Kurz: Default-Deny, HttpOnly/SameSite=Strict-Cookies, CSRF-Header, scrypt-Passwörter, gehashte Tokens nur für Ingest, AES-GCM für Geheimnisse, CSP ohne Inline-Skripte, SSRF-Schutz bei App-Prüfungen, Geheimnis-Ausschluss und Redaktion im Code Explorer.

## 11. Performance

Gemessen (Test `ideas-perf.test.ts`, 600 Projekte + 3000 Module): Bibliotheksseite 7 ms, Volltextsuche 2 ms, Baumebene 12 ms, Dashboard 8 ms. Web: Code-Splitting je Seite, virtualisierte Liste, Infinite-Loading, Graph mit `onlyRenderVisibleElements` und serverseitig aggregierten Kanten (max. 600 sichtbare Knoten).
