# PROJECT_STATE – OMEGA Infinity

> Lebendes Statusdokument. Wird bei jedem größeren Schritt aktualisiert (zuletzt: Aufbau Server-Kern).

## Gesamtziel
Persönliches digitales Betriebssystem: Projektzentrale, App Library, AI Idea Hub, Claude-Ingest (MCP/API/Datei),
read-only GitHub-Integration mit Code Explorer, Konflikt-/Sync-Management, Backups & Wiederherstellung.

## Stand (Work in Progress)
- [x] Stack festgelegt (siehe docs/DECISIONS.md): Node 22 + Hono + SQLite (better-sqlite3) · React 19 + Vite · Zod · Vitest/Playwright
- [x] Gemeinsames Domänenvokabular (`shared/src/domain.ts`) und Ingest-Schema `omega.ingest/v1` (`shared/src/ingest.ts`)
- [x] DB-Schema + Migrationsrunner mit Prüfsummen (`server/src/db`)
- [x] Module: nodes (Hierarchie, Papierkorb, Versionen), apps (Erreichbarkeitsprüfung), ideas (+ KI optional), knowledge,
      categories, tags, activity, notifications, conflicts, ingest, settings, github/repos, github/client, search
- [x] Inhalte: 144 kuratierte Ideen (36 Kategorien), 18 geprüfte Claude-Wissensartikel
- [ ] GitHub-Sync, Code-Analyse, Webhook
- [ ] Backup/Restore
- [ ] Auth + HTTP-Routen + Scheduler
- [ ] Web-UI
- [ ] MCP-Server
- [ ] Tests, visuelle Prüfung, Dokumentation

## Nächster Schritt
GitHub-Sync/Analyzer, danach Backup, Auth und HTTP-Schicht; dann Typecheck & Server-Tests.
