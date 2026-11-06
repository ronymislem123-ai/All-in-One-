# Changelog

## 0.2.0 – 2026-11-06
### Hinzugefügt
- **Werkstatt (`/live`):** Live-Entwicklung mitverfolgen – Gesamtfortschritt, Phase, „Gerade in Arbeit“, Meilensteine, Aufgaben, Protokoll (Recherche, Planung, Entscheidung, Code, Test, Problem) mit Filter, Screenshot-Galerie mit Lightbox, eingebettete Live-Vorschau (Desktop/Smartphone), Aktualisierung per Server-Sent-Events mit Polling-Fallback, LIVE-Abzeichen in der Navigation, Benachrichtigung bei Sitzungsstart und gemeldeten Problemen
- **Austauschformat `omega.live/v1`:** `POST /api/ingest/v1/live/sessions` (Upsert über externalId) und `…/sessions/:externalId/events` (Batch, idempotent); Lese-API `/api/live/*` inkl. SSE-Stream und Bildauslieferung
- **MCP-Server:** 7 neue Werkzeuge `omega_live_start`, `omega_live_log`, `omega_live_milestone`, `omega_live_task`, `omega_live_screenshot`, `omega_live_preview`, `omega_live_status`
- **CLI:** `scripts/omega-live.mjs` – abhängigkeitsfreies Skript zum Streamen aus jeder Shell/CI
- **Datenbank:** Migration `003_dev_live` (`dev_sessions`, `dev_milestones`, `dev_tasks`, `dev_events`, `dev_media`); Bilder als BLOB → Teil jeder Sicherung
- **Tests:** 5 neue Vitest-Tests (Modul, Sicherheit, MCP-E2E, Migration), 2 neue Playwright-Tests (leerer Zustand, gestreamte Sitzung inkl. SSE-Aktualisierung, Lightbox, axe)

### Geändert
- CSP erlaubt `frame-src` für die Live-Vorschau (iframe mit `sandbox`); alle übrigen Direktiven unverändert
- ADR-014 dokumentiert die Trennung: Live-Daten verändern niemals Projektfelder

## 0.1.0 – 2026-11-06
Erste vollständige Ausbaustufe.

### Hinzugefügt
- **Server:** Hono + SQLite (WAL, synchrones Schreiben, FTS5), Migrationen mit Prüfsummen und Sicherung vorab, Default-Deny-HTTP-Schicht, Owner-Auth mit Einrichtungscode, Sessions, CSRF, Rate-Limits, API-Tokens
- **Projekte:** unbegrenzte Hierarchie, Zyklenschutz, Feld-Herkunft, drei Statusachsen, Versionen, Papierkorb, Archiv, Screenshots, Projektgesundheit
- **App Store:** Anwendungsarten, Verfügbarkeitsnachweis mit SSRF-Schutz, manuelle Bestätigung für Desktop-Apps
- **AI Idea Hub:** 144 kuratierte Ideen, 36 Kategorien (DB-verwaltet), 14 lokale Entdeckungsmodi, Varianten/Duplikaterkennung, Entwicklungsauftrag, Idee → Projekt, optionale Claude-API-Generierung
- **Claude Knowledge Hub:** 18 gegen offizielle Doku geprüfte Artikel mit Quellen und Prüfdatum
- **Claude-Integration:** Ingest-Format `omega.ingest/v1`, Ingest-API, MCP-Server (10 Werkzeuge), Datei-Import (JSON/Markdown/Text)
- **GitHub:** read-only Client (ETag, Pagination, Rate-Limit, Retries), Sync, Tarball-Codeanalyse, Webhook mit Signaturprüfung, Branch-Verfolgung (Migration 002), Zuordnungsvorschläge
- **Konflikte & Sync:** 5 Konflikttypen mit Entscheidungen, Sync-Protokoll mit Wiederholung, Datenqualitätsprüfung
- **Backups:** verifizierte, optional verschlüsselte Sicherungen, externe Kopie, Retention, 15-Minuten-Snapshots, Voll- und Projektwiederherstellung
- **Web:** Designsystem (Dark/Light, Dichte, Bewegung), Dashboard (anpassbar), Bibliothek (Karten/virtualisierte Liste/Baum), Projektraum, Sync Center, Konflikte, Code Explorer mit Roboter-Begleiter OMI, Chronik, Backup & Sicherheit, Einstellungen, Command Palette, Benachrichtigungen
- **Tests:** 67 Server-Tests, 13 Playwright-Tests inkl. axe WCAG 2.1 AA
