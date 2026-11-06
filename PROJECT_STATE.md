# PROJECT_STATE – OMEGA Infinity

> Lebendes Statusdokument. Zuletzt aktualisiert: 2026-11-06 (v0.1.0 – erste vollständige Ausbaustufe).

## Gesamtziel
Persönliches digitales Betriebssystem: Projektzentrale, App Library, AI Idea Hub, Claude-Ingest (MCP/API/Datei),
read-only GitHub-Integration mit Code Explorer, Konflikt-/Sync-Management, Backups & Wiederherstellung.

## Stand
**Funktionsfähig und getestet** – siehe [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

- Server (Hono + SQLite), Web (React 19), MCP-Server: implementiert, gebaut, getestet
- Datenbank-Schema Version 2 (`001_init`, `002_tracked_branch`)
- Inhalte: 144 kuratierte Ideen / 36 Kategorien / 112 Kategorieeinträge inkl. Unterkategorien, 18 geprüfte Wissensartikel
- Tests: 67 Server-Tests, 13 Browser-Tests – alle grün

## Verbindliche Architekturentscheidungen
Siehe [docs/DECISIONS.md](docs/DECISIONS.md). Kernpunkte: GitHub nur lesend · keine IDE · drei Statusachsen ·
Feld-Herkunft statt Überschreiben · Ähnlichkeit erzeugt nur Vorschläge · Idempotenz über eventId/externalId ·
Backups als verifizierte Dateien mit Sidecar · KI nur mit echter Anbindung.

## Wichtige Dateien
| Bereich | Dateien |
|---|---|
| Vokabular & Ingest-Format | `shared/src/domain.ts`, `shared/src/ingest.ts` |
| Schema & Migrationen | `server/src/db/database.ts`, `server/src/db/migrations/*` |
| Kernlogik | `server/src/modules/{nodes,ingest,conflicts,backup,ideas,apps,dashboard}.ts`, `server/src/modules/github/*` |
| HTTP & Sicherheit | `server/src/app.ts`, `server/src/http/*`, `server/src/auth/auth.ts` |
| Web | `web/src/App.tsx`, `web/src/design/*`, `web/src/features/*` |
| MCP | `mcp/src/index.ts` |

## Notwendige Konfiguration für den Produktivbetrieb
`OMEGA_BACKUP_PASSPHRASE`, `OMEGA_BACKUP_EXTERNAL_DIR`, `OMEGA_SECRET_KEY`, ggf. `OMEGA_PUBLIC_URL` (https), `GITHUB_TOKEN`,
optional `GITHUB_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`. Siehe `.env.example`.

## Nächster Schritt
Siehe [HANDOFF.md](HANDOFF.md) und [TODO.md](TODO.md).
