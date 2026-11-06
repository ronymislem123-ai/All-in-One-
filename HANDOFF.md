# HANDOFF – Fortsetzungsauftrag für die nächste Claude-Sitzung

## Zuerst lesen
1. `PROJECT_STATE.md` (Stand), 2. `IMPLEMENTATION_STATUS.md` (Abnahme + Tests), 3. `docs/DECISIONS.md` (verbindlich), 4. `TODO.md`.

## Was abgeschlossen ist – NICHT erneut umsetzen
- Vollständige Plattform v0.1.0: Server, Web-UI (alle 11 Bereiche), MCP-Server, Backup/Restore, GitHub-Integration, Ingest-Pipeline, Idea Hub mit 144 Ideen, Knowledge Hub mit 18 Artikeln.
- Tests: 67 Vitest (`npm test`), 13 Playwright (`npm run build:web && npm run test:e2e`) – alle grün am 2026-11-06.
- Sichtprüfung Desktop/Tablet/Smartphone, Dark/Light; axe ohne schwere Verstöße.

## Verbindliche Regeln (nicht ändern ohne neue ADR)
- GitHub ausschließlich lesend (`GitHubClient` kennt nur GET). Keine IDE-Funktionen.
- Website-Daten (Notizen, Priorität, Kategorie, Struktur) werden nie von Claude/GitHub überschrieben → Konflikte.
- Ähnliche Namen führen nie zu Zusammenführungen. Idempotenz über eventId, Identität über externalId.
- KI nur mit echter Anbindung; ohne Schlüssel „nicht eingerichtet“ anzeigen.
- Neue Schemaänderungen nur als neue Migration (`server/src/db/migrations/00X_*.ts` + Eintrag in `MIGRATIONS`), nie bestehende ändern (Prüfsummen!).

## Zuletzt geänderte Dateien
`web/src/features/code/CodeExplorerPage.tsx` (Suche/Zentrierung), `web/src/design/tokens.css` (Kontraste), `e2e/*`, `docs/*`, Statusdokumente.

## Bekannte Grenzen / offene Punkte
Siehe `IMPLEMENTATION_STATUS.md` → „Nicht ausführbar / ungeprüft“ und `TODO.md` (Abschnitt „Hoch“).

## Exakter nächster Arbeitsschritt
1. Mit gesetztem `ANTHROPIC_API_KEY` die KI-Generierung (`POST /api/ideas/generate`) und OMI-Fragen (`POST /api/repos/:id/ask`) live testen; Ergebnisse in `IMPLEMENTATION_STATUS.md` eintragen.
2. Danach den MCP-Server in einer realen Claude-Code-Sitzung verbinden (Befehl unter Einstellungen → Integrationen) und den Ablauf dokumentieren.
3. Anschließend TODO „Hoch“ abarbeiten (Webhook mit öffentlicher URL, externes Backup-Ziel, Deployment-Anleitung).

## Lokale Entwicklung
```bash
npm install
npm run dev          # API :4317, Web :5173
npm run seed:demo    # optional
npm test && npm run typecheck
```
In Umgebungen mit Pflicht-Proxy für GitHub-Zugriffe `NODE_USE_ENV_PROXY=1` setzen.
