# Sicherheit & Datenschutz

## Authentifizierung & Autorisierung
- **Ein Besitzerkonto.** Die Ersteinrichtung erfordert einen einmaligen Einrichtungscode (Server-Log oder `OMEGA_SETUP_CODE`), damit niemand eine frisch gestartete Instanz übernehmen kann.
- **Passwörter:** scrypt (N=2^15, r=8, p=1, 64-Byte-Schlüssel, zufälliges Salt), Mindestlänge 10, zeitkonstanter Vergleich; auch bei unbekannter E-Mail wird gerechnet.
- **Sitzungen:** 32-Byte-Zufallstoken im Cookie `omega_session` (HttpOnly, SameSite=Strict, Secure bei https), in der DB nur als SHA-256-Hash; gleitende Gültigkeit 30 Tage; Liste und Abmeldung einzelner Geräte; Passwortänderung meldet andere Sitzungen ab.
- **Default-Deny:** jeder `/api`-Endpunkt außer Health, Auth-Status/Login/Setup, Webhook und Schema benötigt eine Besitzer-Sitzung.
- **API-Tokens:** `omg_…`, nur gehasht gespeichert, nur einmal angezeigt, Bereiche `ingest`/`read`, widerrufbar, optional mit Ablauf; **ausschließlich** für `/api/ingest/*` zugelassen (Prinzip der geringsten Rechte).
- **CSRF:** cookie-authentifizierte Schreibzugriffe brauchen den Header `X-Omega-CSRF` (nicht ohne CORS-Freigabe von fremden Seiten setzbar) + Origin-Prüfung; zusätzlich SameSite=Strict.
- **Rate-Limits:** Login (pro IP und pro Konto), Ingest, Webhook, Code-Fragen.

## Eingaben & Ausgaben
- Serverseitige Validierung aller Eingaben mit Zod; parametrisierte SQL-Abfragen (kein String-Zusammenbau mit Nutzereingaben).
- **XSS:** React-Escaping; Markdown ohne HTML-Rendering, nur sichere Link-Schemata; App-Startpunkte lehnen `javascript:`/`data:` ab; Code-Highlighting über escapte highlight.js-Ausgabe.
- **CSP:** `default-src 'self'; script-src 'self'` (keine Inline-Skripte), `frame-ancestors 'none'`, `object-src 'none'`; weitere Header: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS bei https; API-Antworten `Cache-Control: no-store`.
- **Uploads:** nur PNG/JPEG/WebP/GIF ≤ 2 MB, Magic-Bytes-Prüfung, Auslieferung mit eigener restriktiver CSP.
- **SSRF:** Verfügbarkeitsprüfungen von Apps blockieren Metadaten-/Link-Local-/Multicast-Adressen, prüfen jede Weiterleitung neu und lesen nur Header.

## Geheimnisse
- GitHub-Token und Webhook-Secret: bevorzugt Umgebungsvariablen; alternativ AES-256-GCM-verschlüsselt in der DB (Schlüssel aus `OMEGA_SECRET_KEY` oder `data/.secret-key`, Rechte 0600). Werte werden nie an den Browser gesendet, nur ein Hinweis (`…abcd`).
- Logs filtern Schlüssel wie `token`, `secret`, `password`, `authorization`, `cookie`.
- Exporte enthalten keine Passwörter, Sitzungen, Tokens oder Geheimnisse.

## Code Explorer
- Strikt lesend. Dateien wie `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `credentials*.json`, `*.tfstate` werden von der Analyse ausgeschlossen und **nie** angezeigt.
- Angezeigte Inhalte werden auf Token-Muster (GitHub, Anthropic, AWS, Slack, Google, Stripe, JWT, private Schlüssel) und Zuweisungen wie `password = "…"` geprüft und geschwärzt.
- Dateiinhalte werden nicht in der Datenbank gespeichert.

## Backups
- Optional verschlüsselt (AES-256-GCM, Schlüsselableitung scrypt), Dateirechte 0600, Prüfsumme je Sicherung, Integritätsprüfung vor jeder Wiederherstellung, Sicherung des Ist-Stands vor jeder Wiederherstellung und jedem Import.
- **Grenze:** OMEGA sichert nur, was ihm übermittelt wurde. Nicht übermittelte Claude-Unterhaltungen sind nicht enthalten.

## Datenschutz (DSGVO-orientiert)
- Datenminimierung: nur Daten, die für die Funktion nötig sind (keine Telemetrie, keine externen Schriften/CDNs, keine Drittanbieter-Aufrufe ohne Konfiguration).
- Export aller Verwaltungsdaten (Art. 20), Löschung über Papierkorb → endgültiges Löschen (Versionshistorie bleibt bis zur Datenbank-Bereinigung; siehe TODO).
- Bei Nutzung der optionalen Claude-API werden ausgewählte Inhalte (Ideenkontext bzw. ausgewählte, geschwärzte Datei) an Anthropic übertragen – nur auf ausdrückliche Aktion.

## Bekannte Grenzen
- Einbenutzersystem (keine Rollenverwaltung für Teams).
- Rate-Limits im Speicher (bei mehreren Server-Instanzen nicht geteilt).
- Kein 2FA (siehe TODO).
