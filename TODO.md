# TODO / sinnvolle Weiterentwicklungen

Priorisiert nach Nutzen. Nichts davon ist für den aktuellen Funktionsumfang erforderlich.

## Hoch
- [ ] KI-Pfade live verifizieren, sobald `ANTHROPIC_API_KEY` gesetzt ist (Ideengenerierung, Fragen an OMI) und Ergebnisse dokumentieren
- [ ] MCP-Server in einer echten Claude-Code-Sitzung einrichten und den Ablauf „Projekt → Module → Fortschritt“ einmal real durchspielen
- [ ] GitHub-Webhook mit öffentlicher URL (Reverse-Proxy mit https) einrichten und Zustellung prüfen
- [ ] Externes Backup-Ziel auf einem anderen Datenträger/Cloud-Mount produktiv einrichten und eine Wiederherstellung daraus testen (Docker-Override `deploy/docker-compose.external-backup.yml` vorhanden und lokal getestet)
- [x] Deployment-Anleitung Docker + Caddy (`docs/DEPLOYMENT.md`) – das produktive Deployment selbst nur nach ausdrücklicher Freigabe
- [ ] Let's-Encrypt-Zertifikat mit echter Domain und Docker-Image auf arm64-Hardware prüfen
- [ ] Optional: systemd-Anleitung ohne Docker

## Mittel
- [ ] 2-Faktor-Authentifizierung (TOTP) und Passkeys
- [ ] Bereinigungsfunktion für alte Versionen/Aktivitäten (Aufbewahrungsfristen, DSGVO-Löschung inkl. Historie)
- [ ] Projektbeziehungen zwischen Projekten (z. B. „nutzt“, „ersetzt“) als eigene Kanten + Visualisierung
- [ ] Screenshot-Vorschau als Kartenbild im App Store
- [ ] Dokumentations-Volltext für Dateiinhalte (aktuell nur Pfade indexiert)
- [ ] Manueller Screenreader-Test (NVDA/VoiceOver)

## Später
- [ ] Mehrbenutzer/Rollen (Lesezugriff für Team)
- [ ] Weitere Datenquellen (z. B. GitLab) über die gleiche Integrationsschicht
- [ ] Geteilte Rate-Limits bei mehreren Server-Instanzen
- [ ] PWA-Offline-Modus (Lesen zuletzt geladener Daten)
