# OMEGA Infinity – persönliches digitales Betriebssystem

Eine zentrale Plattform für deine gesamte digitale Projektlandschaft: **Projektbibliothek**, **persönlicher App Store**,
**AI Idea Hub** (144 kuratierte Ideen in 36 Kategorien), **Claude Knowledge Hub**, **Claude-Anbindung über MCP**,
**read-only GitHub-Integration** mit interaktivem **Code Explorer**, **Konflikt- und Sync-Management** sowie
**verifizierte Backups mit Wiederherstellung** – und der **Werkstatt**, in der du Claude in Echtzeit beim Bauen zusiehst (Fortschritt, Aufgaben, Protokoll, Screenshots, Live-Vorschau).

> Claude bleibt deine Entwicklungsumgebung, GitHub die Quelle der Codebasis – OMEGA ist das Kontrollzentrum.
> OMEGA ist bewusst **keine IDE**: Code wird angezeigt und erklärt, aber nie bearbeitet.

## Schnellstart

```bash
npm install
npm run build            # Web-App, Server und MCP-Server bauen
npm start                # http://127.0.0.1:4317
```

Beim ersten Start steht im Server-Log ein **Einrichtungscode** („Ersteinrichtung: Einrichtungscode …“).
Mit ihm legst du im Browser dein Konto an – so kann niemand anderes eine frisch gestartete Instanz übernehmen.

Entwicklung mit Hot Reload: `npm run dev` (Server auf :4317, Web-App auf :5173 mit API-Proxy).
Optional Beispieldaten (OMEGA beschreibt sich selbst): `npm run seed:demo`.

## Konfiguration (Umgebungsvariablen)

| Variable | Zweck | Standard |
|---|---|---|
| `OMEGA_PORT`, `OMEGA_HOST` | Adresse des Servers | `4317`, `127.0.0.1` |
| `OMEGA_DATA_DIR` | Datenbank & Schlüsseldatei | `./data` |
| `OMEGA_BACKUP_DIR` | Sicherungen | `./backups` |
| `OMEGA_BACKUP_EXTERNAL_DIR` | **Unabhängige** Kopie jeder Sicherung (z. B. eingebundener Cloud-Speicher) | – (empfohlen) |
| `OMEGA_BACKUP_PASSPHRASE` | Verschlüsselt Sicherungen (AES-256-GCM, scrypt) | – (empfohlen) |
| `OMEGA_BACKUP_INTERVAL_MINUTES` | Zwischenstände (nur bei Änderungen) | `15` |
| `OMEGA_SECRET_KEY` | Schlüssel für gespeicherte Geheimnisse (32 Byte base64/hex oder Passphrase) | Datei `data/.secret-key` |
| `OMEGA_PUBLIC_URL` | Öffentliche URL (aktiviert Secure-Cookies bei https, Webhook-URL) | – |
| `OMEGA_SETUP_CODE` | Fester Einrichtungscode (z. B. für automatisierte Installationen) | zufällig, im Log |
| `OMEGA_TRUST_PROXY` | `X-Forwarded-For` hinter Reverse-Proxy auswerten | `false` |
| `GITHUB_TOKEN` | Read-only Token (Metadata + Contents: Read) – alternativ verschlüsselt in den Einstellungen | – |
| `GITHUB_WEBHOOK_SECRET` | Signaturschlüssel für den Webhook | – |
| `GITHUB_POLL_MINUTES` | Abgleich-Intervall | `30` |
| `ANTHROPIC_API_KEY` | Aktiviert echte KI-Ideengenerierung und Fragen an den Code-Begleiter | – (ohne: keine KI-Funktionen, nichts wird vorgetäuscht) |
| `OMEGA_CLAUDE_MODEL` | Modell für die optionalen KI-Funktionen | `claude-opus-5-5` |
| `NODE_USE_ENV_PROXY=1` | Node-`fetch` über `HTTPS_PROXY` (nur in Umgebungen mit Pflicht-Proxy) | – |

Siehe `.env.example`.

## Claude anbinden (MCP)

```bash
npm run build:mcp
claude mcp add --transport stdio --env OMEGA_URL=http://127.0.0.1:4317 --env OMEGA_TOKEN=<Token> omega -- node /pfad/zu/omega-infinity/dist/mcp/index.js
```

Das Token erzeugst du unter **Einstellungen → Integrationen**. Details: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm run dev` | Entwicklungsserver (API + Web) |
| `npm run build` / `npm start` | Produktions-Build / -Start |
| `npm test` | 72 Server-Tests (Vitest) |
| `npm run build:web && npm run test:e2e` | 15 Browser-Tests (Playwright, inkl. axe WCAG 2.1 AA) |
| `node scripts/omega-live.mjs …` | Entwicklungsprozess aus jeder Shell in die Werkstatt streamen (siehe `docs/INTEGRATIONS.md`) |
| `npm run typecheck` | TypeScript-Prüfung des gesamten Projekts |
| `npm run backup` | Manuelle Sicherung von der Kommandozeile |

## Dokumentation

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) – Bedienungsanleitung
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – Architektur, Datenmodell, Quellenwahrheit, Abläufe
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) – Claude (MCP/API/Datei), GitHub, Ingest-Format `omega.ingest/v1`, Werkstatt-Format `omega.live/v1`
- [docs/SECURITY.md](docs/SECURITY.md) – Sicherheits- und Datenschutzkonzept
- [docs/DECISIONS.md](docs/DECISIONS.md) – Architekturentscheidungen
- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) – Abnahme-Matrix und Testergebnisse
- [PROJECT_STATE.md](PROJECT_STATE.md), [HANDOFF.md](HANDOFF.md), [TODO.md](TODO.md), [CHANGELOG.md](CHANGELOG.md)
