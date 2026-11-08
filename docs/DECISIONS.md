# Architekturentscheidungen (ADR)

## ADR-001 · Ein Node/TypeScript-Monorepo statt Microservices
**Problem:** Persönliche Plattform mit vielen Bereichen, ein Betreiber. **Alternativen:** Next.js-Fullstack; getrennte Services; Python-Backend. **Entscheidung:** ein Node-22-Prozess (Hono) + React-SPA + MCP-Server, gemeinsames TypeScript-Vokabular (`shared/`). **Begründung:** ein Typensystem für Server, Web und MCP; einfacher Betrieb (ein Prozess, eine Datei-DB); Hono ist klein, schnell und testbar über `app.request()`. **Risiko:** horizontale Skalierung begrenzt → für Einzelnutzer unkritisch.

## ADR-002 · SQLite (better-sqlite3) als Datenbank
**Alternativen:** PostgreSQL; `node:sqlite` (in Node 22 noch experimentell). **Entscheidung:** better-sqlite3 mit WAL und `synchronous=FULL`. **Begründung:** keine separate Infrastruktur, transaktional, FTS5 für Suche, konsistente Online-Backups per API, sehr schnell bei hunderten Projekten (gemessen: < 15 ms je Abfrage bei 3600 Objekten). **Risiko:** native Abhängigkeit; Mehrbenutzer-Schreiblast → für den Einsatzzweck unkritisch. Migration auf Postgres wäre durch die gekapselte `Db`-Klasse möglich.

## ADR-003 · Adjazenzliste + rekursive CTEs für Hierarchien
**Alternativen:** Nested Sets, Closure Table, materialisierte Pfade. **Entscheidung:** `parent_id` + `WITH RECURSIVE`. **Begründung:** einfache, robuste Verschiebungen; unbegrenzte Tiefe; Zyklenschutz in der Anwendung (Prüfung gegen Nachfahren) plus `CHECK parent_id <> id` und `ON DELETE RESTRICT`. Performance gemessen ausreichend.

## ADR-004 · Drei getrennte Statusachsen
**Problem:** „Von Claude als fertig beschrieben“ ≠ „im Code vorhanden“ ≠ „getestet“. **Entscheidung:** Lebenszyklus (Website/Claude), Code-Status (aus GitHub abgeleitet, nie manuell), Prüfstatus (Owner mit Nachweis). **Begründung:** verhindert vorgetäuschte Fertigmeldungen (§9.4/9.5).

## ADR-005 · Feld-Herkunft statt pauschalem Überschreiben
**Entscheidung:** `field_sources` je Objekt. Claude aktualisiert Felder, die zuletzt von Claude stammen oder nie gesetzt wurden; von der Website geänderte Felder erzeugen einen `field_conflict` mit beiden Werten. Abgelehnte Claude-Werte werden per Hash gemerkt und nicht erneut als Konflikt gemeldet. Struktur, Notizen, Priorität, Favoriten gehören immer der Website.

## ADR-006 · Ähnlichkeit erzeugt nur Vorschläge
Namensähnlichkeit (Levenshtein + Token-Jaccard) führt nie zu Zusammenführungen. Zuordnung über: interne ID → externe Claude-ID → bestätigtes Repository → bestätigte Verknüpfung. Ähnliche Namen → vorläufig separates Objekt + Konflikt.

## ADR-007 · MCP als primärer Claude-Kanal
**Begründung:** Die Anthropic API bietet keinen Zugriff auf Claude.ai-Inhalte. MCP ist der offiziell unterstützte Weg, über den Claude (Code/Desktop) aktiv Werkzeuge aufruft. Ergänzt durch Ingest-API und Datei-Import. Inhaltsbasierte eventIds im MCP-Server machen wiederholte Aufrufe idempotent.

## ADR-008 · GitHub-Analyse über Tarball statt Datei-für-Datei
**Begründung:** eine Anfrage pro Commit statt Hunderter (Rate-Limit), Analyse im Speicher, keine Dateiinhalte in der DB (Datenminimierung, privater Code bleibt auf GitHub). Inhalte für den Viewer werden bei Bedarf geladen und geschwärzt.

## ADR-009 · Backups als Dateien mit Sidecar-Metadaten
**Begründung:** Metadaten in der DB würden bei einer Wiederherstellung mit zurückgesetzt. Sidecars neben den Dateien bleiben konsistent; externe Kopie unabhängig vom DB-Datenträger. Snapshots nur bei Änderungen (inkrementelle Ebene = Versionen + Aktivitätsprotokoll in der DB).

## ADR-010 · Zugangsdaten überdauern eine Vollwiederherstellung
Konto, Sitzungen, Tokens, Geheimnisse und Einstellungen werden bei einer Vollwiederherstellung übernommen. Sonst könnte ein altes Backup den Besitzer aussperren oder widerrufene Tokens reaktivieren.

## ADR-011 · Eigenes CSS-Designsystem statt UI-Framework
**Begründung:** eigenständige Identität („Mission Control at night“), zentrale Tokens für Dark/Light/Dichte/Bewegung, kleine Bundles, volle Kontrolle über Barrierefreiheit (geprüft mit axe). Light-Mode eigenständig gestaltet.

## ADR-012 · KI nur mit echter Anbindung
Ohne `ANTHROPIC_API_KEY` sind KI-Funktionen deaktiviert und als „nicht eingerichtet“ markiert; der Idea Hub nutzt dann transparent die kuratierte Bibliothek (`engine: "local-library"`). Modell standardmäßig `claude-opus-5-5`, strukturierte JSON-Ausgabe, serverseitige Fallbacks.

## ADR-013 · Branch-Verfolgung je Repository (Migration 002)
Entwicklung findet oft auf Feature-Branches statt. Ein Repository kann einem gewählten Branch folgen; ein Wechsel erzwingt einen frischen Abgleich und eine neue Analyse.

## ADR-014 · Werkstatt: Live-Entwicklung als eigener, nur darstellender Bereich (Migration 003)
**Problem:** Der Besitzer möchte den Entstehungsprozess einer App in Echtzeit mitverfolgen (Fortschritt, Aufgaben, Recherche, Entscheidungen, Screenshots, Vorschau), nicht nur das Ergebnis. **Alternativen:** separate Anwendung; Protokoll als Markdown-Dokumente im Projekt; WebSocket-Server. **Entscheidung:** Bereich „Werkstatt“ (`/live`) mit eigenem Austauschformat `omega.live/v1`. Claude schreibt über die bestehende, abgesicherte Ingest-Schnittstelle (`/api/ingest/v1/live/*`, Token-Bereich `ingest`), die Oberfläche liest über Owner-Session und empfängt Änderungen per Server-Sent-Events (Fallback: Polling). Eigene Tabellen (`dev_sessions`, `dev_milestones`, `dev_tasks`, `dev_events`, `dev_media`); Bilder als BLOB, damit sie Teil jeder Sicherung sind. **Regel:** Live-Daten verändern **niemals** Projektfelder oder Statusachsen (Fortschritt im Projekt bleibt von Claudes Live-Meldungen unberührt, ADR-004/005 gelten weiter). **Begründung:** SSE braucht keine neue Abhängigkeit und passt zur CSP; Idempotenz über `(session, eventId)` wie bei der Ingest-Pipeline; ein eigener Bereich hält Projektbibliothek und Live-Strom sauber getrennt. **Risiko:** viele Ereignisse pro Sitzung → Ereignisse werden paginiert, Bilder dedupliziert (SHA-256) und auf 3 MB begrenzt.
