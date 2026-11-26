---
name: werkstatt
description: Öffnet in jeder Sitzung automatisch die Werkstatt (Live-Entwicklungsboard) und streamt den gesamten Arbeitsprozess hinein – Fortschritt, Aufgaben, Recherche, Entscheidungen, Code, Tests, Probleme, Screenshots, Vorschau. Gilt für jede Aufgabe, egal ob Code, Text, Analyse oder Design. Auch bei "/werkstatt", "Werkstatt öffnen", "zeig mir live was du machst".
---

# Werkstatt – Claude live beim Arbeiten zusehen

Der Besitzer möchte bei **jeder** Aufgabe mitverfolgen, was gerade entsteht. Die Werkstatt ist dafür immer mit geöffnet. Es gibt zwei Ziele; nutze alle, die in der Sitzung erreichbar sind:

| Ziel | Wann | Werkzeug |
|---|---|---|
| **Live-Board (Artifact)** | immer, in jeder Claude-Code-Sitzung | `Artifact` (open/publish) + `ArtifactData` (Datenbank des Boards) |
| **OMEGA-Werkstatt** (`/live` in OMEGA Infinity) | wenn die MCP-Werkzeuge `omega_live_*` oder `scripts/omega-live.mjs` mit `OMEGA_TOKEN` erreichbar sind | `omega_live_start`, `omega_live_log`, `omega_live_milestone`, `omega_live_task`, `omega_live_screenshot`, `omega_live_preview`, `omega_live_status` |

Board-Adresse: **https://claude.ai/artifact/CWpQSQkkrQbiAeGMvWQDEa** (privates Artifact des Besitzers; Datenmodell siehe unten).

## Ablauf – ohne Rückfrage, bei jeder Aufgabe

1. **Sofort beim ersten Arbeitsschritt (vor Recherche oder Code):**
   - `Artifact` mit `action: "open"` und der Board-Adresse aufrufen, damit das Board neben dem Chat sichtbar ist.
   - Eine neue Sitzung anlegen (eine `ArtifactData`-Batch):
     - `sessions/<id>`: `{ "title": "<Projekt · Aufgabe>", "startedAt": "<ISO>", "statusDoc": "<id>" }`
     - `status/<id>`: `{ "title", "state": "planning", "phase", "now", "startedAt", "updatedAt", "progress": null }`
     - Meilensteine `milestones/<id>-<key>` mit `session: "<id>"`, `key`, `label`, `order`, `progress`, `status` (`pending|active|done|blocked`)
     - Aufgaben `tasks/<id>-<key>` mit `session`, `key`, `title`, `status` (`todo|doing|done|blocked`), `order`, optional `detail`
   - `<id>`: Kurzname plus Datum, z. B. `shop-2026-11-26`. Nur Buchstaben, Ziffern, `-`, `_`.
   - Dem Besitzer in einer Zeile sagen, dass das Board offen ist und mitläuft.
2. **Während der Arbeit, nach jedem sichtbaren Schritt** (Recherche abgeschlossen, Entscheidung getroffen, Datei geschrieben, Test gelaufen, Problem gefunden):
   - Protokolleintrag `log/<id>-<laufnummer>`: `{ "session", "at", "kind", "title", "body" }` mit `kind` aus `research|plan|decision|build|test|problem|milestone|log`. Entscheidungen immer mit Begründung, Probleme immer mit Lösung.
   - Meilenstein-/Aufgabenstände per `update` (mit `if_version` aus der letzten Antwort) fortschreiben; `status/<id>.now` beschreibt in einem Satz, was gerade passiert; `state` ist `planning|building|testing|done|paused`.
   - Mehrere Änderungen in **einer** Batch bündeln; nicht nach jedem Tool-Aufruf schreiben, sondern pro Arbeitsschritt (grob alle 5–10 Minuten).
3. **Bilder:** nach jedem sichtbaren Zwischenstand (Oberfläche, Mockup, Diagramm) einen Screenshot aufnehmen, per `Artifact` mit `asset: true` hochladen und `shots/<id>-s<nr>` schreiben: `{ "session", "at", "title", "caption", "asset": "<id aus dem Upload>" }`. Vorher/Nachher: beim späteren Bild `"before": "<doc-id des früheren Bildes>"` setzen.
4. **Vorschau:** sobald ein Dev-Server läuft, `report_preview_port` aufrufen und `status/<id>.previewUrl` + `previewNote` setzen.
5. **Zum Schluss:** `status/<id>` auf `state: "done"`, `progress: 100`, `now: null` setzen, letzten Meilenstein-Eintrag schreiben, Aufgaben abschließen.

## OMEGA-Werkstatt zusätzlich (wenn erreichbar)

Gleiche Schritte spiegeln: `omega_live_start` (externalId = `<id>`, Meilensteine, Aufgaben) → laufend `omega_live_log`, `omega_live_milestone`, `omega_live_task`, `omega_live_screenshot` (Dateipfad), `omega_live_preview` → am Ende `omega_live_status` mit `state: "done"`. Ohne MCP: `node scripts/omega-live.mjs …` mit `OMEGA_URL`, `OMEGA_TOKEN`, `OMEGA_LIVE_ID`.

## Regeln

- Keine Rückfrage, ob das Board gewünscht ist – es ist immer gewünscht.
- Niemals Schreibzugriffe auf fremde Sitzungen (andere `session`-Werte) verändern oder löschen.
- `if_version` bei jedem `update`/`set` auf bestehende Dokumente mitsenden; bei Versionskonflikt neu lesen und erneut schreiben.
- Keine Geheimnisse (Tokens, Passwörter, private Daten) ins Board schreiben.
- Das Board ist Beobachtung, nicht Ersatz für die Antwort im Chat: Ergebnis und Link weiterhin im Chat nennen.
