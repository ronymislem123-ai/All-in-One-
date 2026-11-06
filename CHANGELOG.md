# Changelog

## 0.1.1 – 2026-11-06
Docker-Deployment.

### Hinzugefügt
- **Docker:** zweistufiges `Dockerfile` (unprivilegierter Benutzer, Healthcheck, ohne Compiler baubar), `docker-compose.yml` mit schreibgeschütztem Dateisystem, `cap_drop: ALL`, Port nur lokal
- **HTTPS:** Profil `https` mit Caddy (Let's Encrypt per E-Mail oder eigene CA für Heimnetz/NAS), `deploy/Caddyfile`
- **Backups:** Override `deploy/docker-compose.external-backup.yml` für eine unabhängige Kopie auf einem zweiten Datenträger
- **Notfall-Wiederherstellung:** `node dist/server/cli.js restore-offline <name> --server-gestoppt` (bisherige Datenbank bleibt erhalten)
- **Dokumentation:** `docs/DEPLOYMENT.md` mit Prüfprotokoll; Vorlage `deploy/env.docker.example`

### Behoben
- Sicherungen hinterließen `-wal`/`-shm`-Dateien im Backup-Ordner (temporäre Dateien und unverschlüsselte Sicherungen). Sicherungen sind jetzt eigenständige SQLite-Dateien; Regressionstest ergänzt
- Kommandozeile gibt Fehler als verständliche Meldung mit Exit-Code 1 aus statt als Stacktrace

### Geändert
- Reine Web-Pakete (React, Router, xyflow …) sind jetzt `devDependencies` – das Laufzeit-Image enthält nur Serverpakete

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
