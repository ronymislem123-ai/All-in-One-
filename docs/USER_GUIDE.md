# Bedienungsanleitung

## Erste Schritte
1. Server starten (`npm start`) und den **Einrichtungscode** aus dem Server-Log kopieren.
2. Im Browser `http://127.0.0.1:4317` öffnen → Code, Name, E-Mail und Passwort eingeben → **Einrichten**.
3. Optional: `npm run seed:demo` legt „OMEGA Infinity“ als Beispielprojekt an.

**Überall nützlich:** `Strg/⌘ + K` oder `/` öffnet die **Command Palette** (Suche über Projekte, Ideen, Apps, Repositories, Dateien + Aktionen wie „Neues Projekt“, „Backup erstellen“). Das Sonnen-/Mond-Symbol wechselt das Design.

## Neue Projekte anlegen
**Projekte → Neues Projekt** (oder Dashboard → „+ Projekt“). Name genügt; alles Weitere ist optional. Im Projektraum:
- **Unterobjekt** fügt Module, Funktionen, Komponenten oder Dokumentation hinzu – beliebig tief.
- **Bearbeiten**: Kategorie, Status, Priorität, Fortschritt, Codepfad, persönliche Notizen, Prüfstatus mit Nachweis.
- **⋯** → Verschieben, Repository verknüpfen, Archivieren (Daten bleiben), In den Papierkorb.
- Reiter **Versionen**: jede Änderung ist eine Version und lässt sich wiederherstellen.

Die Statusleiste zeigt drei getrennte Angaben: *Lebenszyklus* · *Code-Status aus GitHub* · *Prüfstatus*.

## Claude-Informationen übermitteln
- **Automatisch (empfohlen):** MCP-Server einrichten (Einstellungen → Integrationen → Token erzeugen, dann den angezeigten `claude mcp add …`-Befehl ausführen). Danach kann Claude Code mit `omega_upsert_project`, `omega_upsert_module`, `omega_report_progress` usw. Projekte und Fortschritte melden.
- **Aus Claude.ai-Chats:** Lass Claude eine Markdown-Datei mit Kopfbereich `omega: project` erzeugen (Format in [INTEGRATIONS.md](INTEGRATIONS.md)) und füge sie unter **Sync Center → Import** ein → Vorschau → Importieren. Wiederholte Importe erzeugen keine Duplikate.
- Im **Sync Center → Protokoll** siehst du jedes empfangene Ereignis und kannst fehlgeschlagene wiederholen.

## Ein GitHub-Repository verknüpfen
1. **Sync Center → GitHub**: `owner/repo` eingeben → *Hinzufügen & abgleichen*. Mit Token (Einstellungen → Integrationen) erkennt *Automatisch erkennen* alle autorisierten Repositories.
2. Verknüpfen: im Projekt **Code & Apps → Verknüpfen** oder einen **Zuordnungsvorschlag bestätigen**. Ohne Bestätigung wird nie verknüpft.
3. Module mit **Codepfad** zeigen dann „In GitHub erkannt“ bzw. „nicht gefunden“.

## Anwendungen öffnen
**App Store → + Anwendung**: Art (Web-App, externe URL, interne Anwendung, Desktop, Produktseite) und Startpunkt angeben → **Prüfen**. Erst nach erfolgreicher Prüfung gilt sie als *Verfügbar (geprüft)*; Desktop-Apps bestätigst du über *Start bestätigen* (angezeigt als „Manuell bestätigt“). **Öffnen** startet die App (intern, neuer Tab oder Startanleitung).

## Den AI Idea Hub nutzen
- **Ideen entdecken:** Modus wählen (z. B. *Kleine Tools*, *Lösung für ein Problem*, *Bestehende Projekte erweitern*, *Ideen kombinieren*) → **Aus Bibliothek**. Mit `ANTHROPIC_API_KEY` zusätzlich **Mit Claude generieren**.
- **Stöbern:** Kategorien links, Volltextsuche, Filter (Aufwand, Nutzen, Favoriten, Gespeichert), Sortierung.
- Stern = Favorit, *Speichern* = auf die Merkliste. Bewertungen sind Einschätzungen, keine Fakten.
- **Idee erfassen:** OMEGA warnt bei sehr ähnlichen Ideen und bietet *Als Weiterentwicklung speichern* an.

## Ideen in Projekte übernehmen
In der Idee **Als Projekt übernehmen** → Name/Kategorie bestätigen. Es entstehen ein Projekt und das Dokument **Entwicklungsauftrag**. Mit **Entwicklungsauftrag → Kopieren** fügst du ihn in Claude ein. Danach Repository verknüpfen und die fertige App im App Store eintragen.

## Den Code Explorer verwenden
**Code Explorer → Repository** öffnen:
- Ordner über den Pfeil aufklappen, Datei/Ordner anklicken → Details rechts. Doppelklick auf eine Datei öffnet den **lesenden Quelltext** (Geheimnisse werden geschwärzt, Zugangsdatei-Typen nie angezeigt).
- **Einfach/Technisch** wechselt die Erklärungsebene. Gestrichelte Linien = erkannte Import-Abhängigkeiten (mit Anzahl); Rollenfarben sind Vermutungen.
- **OMI → Zeig es mir** startet eine Tour durch die Hauptbereiche. Mit Claude-API beantwortet OMI auch Fragen.
- Suche findet Pfade im ganzen Repository; die Branch-Auswahl im Kopf wechselt den verfolgten Branch.

## Synchronisierungen überprüfen
**Sync Center → Verbindungen**: Ampelstatus (grün erfolgreich · gelb Aufmerksamkeit · rot kritisch · grau nicht eingerichtet) für Claude, GitHub, KI, Datenbank, Backups sowie die letzten Läufe. **Datenqualität** listet fehlende Beschreibungen, nicht zugeordnete Einträge, veraltete GitHub-Daten und undokumentierte Ordner.

## Konflikte bearbeiten
**Konflikte** zeigt offene Entscheidungen. Im Detail siehst du beide Datenstände bzw. Kandidaten und wählst z. B. *Bestehendes Projekt verwenden*, *Als Untermodul zuordnen*, *Website-Stand beibehalten* oder *Claude-Stand übernehmen*. Jede Entscheidung wird protokolliert.

## Backups kontrollieren
**Backup & Sicherheit → Sicherungen**: Status, Zeitplan (alle 15 Minuten, nur bei Änderungen), Verschlüsselung, externe Kopie und alle Wiederherstellungspunkte mit Prüfergebnis. *Jetzt sichern* erstellt eine verifizierte Sicherung; *Prüfen* kontrolliert Prüfsumme und Integrität erneut. Empfohlen: `OMEGA_BACKUP_PASSPHRASE` und `OMEGA_BACKUP_EXTERNAL_DIR` setzen.

## Daten wiederherstellen
- **Einzelnes Objekt:** Projektraum → *Versionen* → *Wiederherstellen*.
- **Gelöschtes:** Backup & Sicherheit → *Papierkorb* → *Wiederherstellen*.
- **Ein Projekt aus einer Sicherung:** Sicherungen → *Projekt* → Projekt wählen.
- **Alles:** Sicherungen → *Alles* → „WIEDERHERSTELLEN“ eintippen. Vorher wird automatisch der aktuelle Stand gesichert; dein Konto bleibt erhalten.
- **Export/Import:** Backup & Sicherheit → *Import & Export* (JSON ohne Geheimnisse; Import überschreibt nie bestehende Einträge).
