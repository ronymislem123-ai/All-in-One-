# Deployment mit Docker

Diese Anleitung bringt OMEGA Infinity mit Docker auf einen eigenen Rechner, einen NAS/Heimserver oder einen
gemieteten Server (VPS). Alle Befehle werden im Projektordner ausgeführt.

> **Wichtig:** Diese Anleitung beschreibt, *wie* du OMEGA betreibst. Ein produktives Deployment wurde nicht
> durchgeführt – das entscheidest und startest du selbst. Was in der Entwicklungsumgebung tatsächlich getestet
> wurde, steht am Ende unter [„Geprüft“](#was-wurde-geprüft).

## Inhalt
1. [Aufbau](#aufbau)
2. [Voraussetzungen](#voraussetzungen)
3. [Schnellstart: nur auf diesem Rechner](#schnellstart-nur-auf-diesem-rechner)
4. [Mit HTTPS: Server mit eigener Domain](#mit-https-server-mit-eigener-domain)
5. [Mit HTTPS: Heimnetz oder NAS ohne Domain](#mit-https-heimnetz-oder-nas-ohne-domain)
6. [Datensicherung](#datensicherung)
7. [Wiederherstellung](#wiederherstellung)
8. [Updates](#updates)
9. [Claude Code (MCP) und GitHub](#claude-code-mcp-und-github)
10. [Sicherheit des Containers](#sicherheit-des-containers)
11. [Betrieb und Fehlerbehebung](#betrieb-und-fehlerbehebung)
12. [Geprüft](#was-wurde-geprüft)

---

## Aufbau

```
Browser ──HTTPS──▶  caddy (Profil "https")  ──▶  omega :4317  ──▶  Volume omega-data     (/data:   Datenbank)
                    Port 80/443, Zertifikate                   └─▶  Volume omega-backups  (/backups: Sicherungen)
                                                               └─▶  optional: externer Ordner (/backups-external)
Dieser Rechner ──HTTP──▶ 127.0.0.1:4317 (immer nur lokal)
```

| Datei | Zweck |
|---|---|
| `Dockerfile` | Zweistufiger Build: baut Web-App, Server und MCP-Server; das Laufzeit-Image enthält nur Produktionspakete |
| `docker-compose.yml` | Dienst `omega` (immer) und `caddy` (nur mit `--profile https`) |
| `deploy/Caddyfile` | Reverse-Proxy mit automatischem HTTPS |
| `deploy/env.docker.example` | Vorlage für `.env` (Einstellungen und Geheimnisse) |
| `deploy/docker-compose.external-backup.yml` | Zusatz: jede Sicherung zusätzlich auf einen anderen Datenträger kopieren |

Die Daten liegen in **benannten Docker-Volumes** (`omega_omega-data`, `omega_omega-backups`). Sie bleiben bei
Neustarts, Updates und `docker compose down` erhalten. Nur `docker compose down -v` löscht sie – diesen Befehl im
Betrieb **nie** verwenden.

## Voraussetzungen

- Docker Engine mit **Docker Compose 2.24 oder neuer** (`docker compose version`). Auf Windows/macOS: Docker Desktop.
- Prozessor **x64 oder arm64** (z. B. Intel/AMD, Apple Silicon, Raspberry Pi 4/5 mit 64-Bit-System, ARM-Server).
  Für 32-Bit-ARM siehe [Fehlerbehebung](#betrieb-und-fehlerbehebung).
- Arbeitsspeicher: OMEGA belegt im Leerlauf rund 50 MB, Caddy rund 25 MB. 512 MB frei reichen.
- Für HTTPS mit Domain: DNS-Eintrag auf den Server und offene Ports 80 und 443.

## Schnellstart: nur auf diesem Rechner

```bash
git clone <URL deines Repositorys> omega-infinity && cd omega-infinity

# 1. Einstellungen anlegen (Datei bleibt lokal, steht in .gitignore)
cp deploy/env.docker.example .env
chmod 600 .env

# 2. Zwei zufällige Geheimnisse erzeugen und in .env eintragen
openssl rand -base64 32    # → OMEGA_SECRET_KEY=…
openssl rand -base64 48    # → OMEGA_BACKUP_PASSPHRASE=…
```

Unter Linux geht Schritt 2 auch automatisch:

```bash
sed -i "s|^OMEGA_SECRET_KEY=.*|OMEGA_SECRET_KEY=$(openssl rand -base64 32)|" .env
sed -i "s|^OMEGA_BACKUP_PASSPHRASE=.*|OMEGA_BACKUP_PASSPHRASE=$(openssl rand -base64 48)|" .env
```

```bash
# 3. Bauen und starten (der erste Build dauert einige Minuten)
docker compose up -d --build

# 4. Einmaligen Einrichtungscode aus dem Server-Log holen
docker compose logs omega | grep Einrichtungscode
```

Enthält ein selbst gewählter Wert ein `$`-Zeichen, ihn in einfache Anführungszeichen setzen (`KEY='a$b'`) –
sonst ersetzt Docker Compose den Teil nach `$` stillschweigend.

Dann **http://127.0.0.1:4317** öffnen, Einrichtungscode, Name, E-Mail und Passwort eingeben – fertig.
Der Port ist bewusst nur auf diesem Rechner erreichbar. Anderen Port wählen: `OMEGA_LOCAL_PORT=8080` in `.env`.

> **Bewahre `OMEGA_BACKUP_PASSPHRASE` und `OMEGA_SECRET_KEY` getrennt vom Server auf** (z. B. im Passwortmanager).
> Ohne die Passphrase sind die verschlüsselten Sicherungen nicht lesbar. Ohne den Schlüssel müssen gespeicherte
> Zugangsdaten (GitHub-Token, Webhook-Secret) neu eingegeben werden.

## Mit HTTPS: Server mit eigener Domain

1. DNS: `A`- (und ggf. `AAAA`-)Eintrag für z. B. `omega.example.com` auf die IP des Servers.
2. Firewall: Ports **80** und **443** öffnen (80 wird für die Zertifikatsausstellung und die Umleitung gebraucht).
3. In `.env` ergänzen:

   ```ini
   OMEGA_DOMAIN=omega.example.com
   OMEGA_PUBLIC_URL=https://omega.example.com
   OMEGA_TRUST_PROXY=true
   CADDY_TLS=du@example.com
   ```

   Mit einer E-Mail-Adresse in `CADDY_TLS` holt Caddy automatisch ein Let's-Encrypt-Zertifikat und erneuert es.

4. Starten:

   ```bash
   docker compose --profile https up -d --build
   docker compose logs omega | grep Einrichtungscode
   ```

5. **https://omega.example.com** öffnen und einrichten.

Was dadurch aktiv wird: HTTP leitet auf HTTPS um, das Sitzungs-Cookie bekommt das `Secure`-Attribut, die App sendet
HSTS und eine strikte Content-Security-Policy, Caddy entfernt den `Server`-Header. Rate-Limits sehen die echte
Client-IP, weil Caddy `X-Forwarded-For` selbst setzt und von Clients gesendete Werte verwirft.

**Eigener Reverse-Proxy statt Caddy** (nginx, Traefik …): Profil `https` weglassen, den Proxy auf
`127.0.0.1:4317` zeigen lassen, den `Host`-Header unverändert weiterreichen und `OMEGA_PUBLIC_URL` setzen.
`OMEGA_TRUST_PROXY=true` nur verwenden, wenn der Proxy `X-Forwarded-For` **überschreibt** statt zu ergänzen –
sonst können Clients ihre IP für die Rate-Limits fälschen. Diese Variante wurde nicht getestet.

## Mit HTTPS: Heimnetz oder NAS ohne Domain

Ohne öffentliche Domain stellt Caddy das Zertifikat mit einer eigenen, lokalen Zertifizierungsstelle aus:

```ini
OMEGA_DOMAIN=omega.home.arpa        # oder der Hostname/die IP des NAS im Heimnetz
OMEGA_PUBLIC_URL=https://omega.home.arpa
OMEGA_TRUST_PROXY=true
CADDY_TLS=internal
```

```bash
docker compose --profile https up -d --build
```

Der Browser warnt zunächst, weil er Caddys Stammzertifikat nicht kennt. Dieses Zertifikat einmal exportieren und
auf deinen Geräten als vertrauenswürdig installieren:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./omega-root.crt
```

Der Name in `OMEGA_DOMAIN` muss im Heimnetz auflösbar sein (Router-DNS oder `hosts`-Datei).
Für den Zugriff von unterwegs ist ein VPN ins Heimnetz sicherer als eine Portfreigabe.

## Datensicherung

| Was | Wann |
|---|---|
| Automatische Snapshots | alle 15 Minuten, **nur wenn sich Daten geändert haben** (`OMEGA_BACKUP_INTERVAL_MINUTES`) |
| Sicherung beim Herunterfahren | bei `docker compose stop/restart/down` und Updates, wenn es ungesicherte Änderungen gibt |
| Vor jeder Wiederherstellung und jeder Datenbank-Migration | automatisch |
| Manuell | Oberfläche → *Backup & Sicherheit* oder Kommandozeile (unten) |

Jede Sicherung wird nach dem Schreiben geprüft (SQLite-Integritätsprüfung, SHA-256-Prüfsumme) und ist mit
`OMEGA_BACKUP_PASSPHRASE` verschlüsselt (AES-256-GCM). Zu jeder Sicherung `X.sqlite.enc` gehört eine Datei
`X.sqlite.enc.json` mit Prüfsumme und Inhaltsübersicht – **beide Dateien immer zusammen kopieren**.

```bash
# Sicherung erstellen, auflisten, prüfen
docker compose exec omega node dist/server/cli.js backup "vor dem Umbau"
docker compose exec omega node dist/server/cli.js backups
docker compose exec omega node dist/server/cli.js verify <name>
```

### Kopie außerhalb des Servers (dringend empfohlen)

Volumes liegen auf derselben Festplatte wie der Server. Gegen Plattendefekt, Diebstahl oder Fehlbedienung hilft nur
eine Kopie an einem anderen Ort.

**Automatisch auf einen anderen Datenträger** (NAS-Freigabe, USB-Platte, eingebundener Cloud-Ordner):

```bash
sudo mkdir -p /mnt/nas/omega-backups && sudo chown 1000:1000 /mnt/nas/omega-backups
echo "OMEGA_EXTERNAL_BACKUP_PATH=/mnt/nas/omega-backups" >> .env

docker compose -f docker-compose.yml -f deploy/docker-compose.external-backup.yml up -d
# mit HTTPS zusätzlich:  --profile https
```

OMEGA kopiert dann jede Sicherung samt Metadaten dorthin und vergleicht die Prüfsumme der Kopie. Schlägt die Kopie
fehl, erscheint eine Warnung in der Oberfläche; die lokale Sicherung bleibt gültig.

**Von Hand auf deinen Rechner holen:**

```bash
docker compose cp omega:/backups ./omega-backups-kopie
```

## Wiederherstellung

**Normalfall – über die Oberfläche:** *Backup & Sicherheit* → Sicherung wählen → *Wiederherstellen*. OMEGA erstellt
vorher automatisch eine Sicherung des aktuellen Stands, prüft die gewählte Sicherung und behält dein Konto bei.
Einzelne Projekte lassen sich ebenso zurückholen, ohne den Rest zu verändern.

**Notfall – die Oberfläche startet nicht mehr:**

```bash
docker compose stop omega
docker compose run --rm --no-deps omega node dist/server/cli.js restore-offline <name> --server-gestoppt
docker compose up -d          # mit HTTPS:  docker compose --profile https up -d
```

Die bisherige Datenbank wird nicht gelöscht, sondern als `/data/omega.sqlite.vor-wiederherstellung-<Zeit>`
aufbewahrt. Anmeldungen, die nach dem Zeitpunkt der Sicherung entstanden sind, sind danach ungültig – einfach neu
anmelden. Läuft alles wieder, kannst du die aufbewahrte Datei später selbst entfernen
(`docker compose exec omega rm /data/omega.sqlite.vor-wiederherstellung-<Zeit>`).

**Umzug auf einen neuen Server / Sicherung von außen einspielen:**

```bash
# Auf dem neuen Server zuerst .env mit DERSELBEN OMEGA_BACKUP_PASSPHRASE und OMEGA_SECRET_KEY anlegen und starten.
docker compose cp ./omega-…sqlite.enc      omega:/backups/
docker compose cp ./omega-…sqlite.enc.json omega:/backups/
# danach über die Oberfläche wiederherstellen (oder per restore-offline wie oben)
```

## Updates

```bash
git pull
docker compose up -d --build                         # ggf. mit --profile https und -f …external-backup.yml
docker compose logs omega | grep -i migration
```

Beim Stoppen des alten Containers entsteht eine Sicherung; vor jeder Schemaänderung legt OMEGA zusätzlich eine
Sicherung an. Zurück auf die vorherige Version: alten Stand auschecken (`git checkout <commit>`), neu bauen und – falls
die neue Version bereits migriert hat – die Sicherung **vor** der Migration wiederherstellen (eine ältere Version
lehnt Sicherungen mit neuerem Schema bewusst ab).

## Claude Code (MCP) und GitHub

**MCP-Server mit Docker nutzen** (Claude Code läuft auf demselben Rechner wie Docker):

1. In OMEGA unter *Einstellungen → Integrationen* einen API-Token erzeugen.
2. Claude Code verbinden:

   ```bash
   claude mcp add --transport stdio --env OMEGA_TOKEN=<token> omega -- \
     docker compose -f /absoluter/pfad/zu/omega-infinity/docker-compose.yml exec -T -e OMEGA_TOKEN omega node dist/mcp/index.js
   ```

   Der MCP-Server läuft dann im bestehenden Container und spricht OMEGA intern an. Der Token wird nur durchgereicht,
   nicht im Image gespeichert.

**OMEGA läuft auf einem entfernten Server:** Den MCP-Server lokal aus einem Checkout starten und auf die HTTPS-Adresse
zeigen lassen:

```bash
npm ci && npm run build:mcp
claude mcp add --transport stdio --env OMEGA_URL=https://omega.example.com --env OMEGA_TOKEN=<token> omega -- \
  node /pfad/zu/omega-infinity/dist/mcp/index.js
```

**GitHub** (nur lesend): Token in *Einstellungen → Integrationen* speichern oder `GITHUB_TOKEN` in `.env`.
Ein **Webhook** braucht eine öffentlich erreichbare HTTPS-Adresse (Profil `https` mit Domain): Payload-URL
`https://<domain>/api/webhooks/github`, Content type `application/json`, Secret wie `GITHUB_WEBHOOK_SECRET`.
Ohne Secret lehnt OMEGA Webhooks ab. Ohne Webhook gleicht OMEGA regelmäßig ab (`GITHUB_POLL_MINUTES`).

## Sicherheit des Containers

- Läuft als unprivilegierter Benutzer `node` (UID 1000), ohne Linux-Capabilities, mit `no-new-privileges`.
- Schreibgeschütztes Dateisystem; beschreibbar sind nur `/data`, `/backups` und ein temporäres `/tmp` im Speicher.
- Der App-Port ist nur an `127.0.0.1` gebunden. Von außen erreichbar ist ausschließlich Caddy (Profil `https`).
- `.env` wird nicht ins Image kopiert (`.dockerignore`) und sollte `chmod 600` haben.
- Geheimnisse aus `.env` sind für jeden mit Docker-Zugriff per `docker inspect` sichtbar. Docker-Zugriff ist
  gleichbedeutend mit Root-Zugriff – nur vertrauenswürdige Benutzer in die Gruppe `docker` aufnehmen.
- Der Einrichtungscode steht nur im Server-Log und ist nach der Einrichtung wertlos. Wer `OMEGA_SETUP_CODE` setzt,
  sollte den Eintrag danach wieder entfernen.

## Betrieb und Fehlerbehebung

```bash
docker compose ps                     # Zustand inkl. Healthcheck
docker compose logs -f omega          # Server-Log (JSON-Zeilen)
docker compose restart omega          # Neustart (mit Sicherung bei Änderungen)
docker stats --no-stream              # Speicher/CPU
```

| Problem | Lösung |
|---|---|
| Einrichtungscode nicht zu finden | `docker compose logs omega \| grep Einrichtungscode`. Alternativ `OMEGA_SETUP_CODE=…` in `.env` setzen und `docker compose up -d` |
| `env_file … required` / unbekannte Option | Docker Compose ist zu alt – auf 2.24 oder neuer aktualisieren |
| Anmeldung über HTTPS scheitert mit 403 | `OMEGA_PUBLIC_URL` muss exakt der Adresse im Browser entsprechen (inkl. `https://`, ohne `/` am Ende) |
| Caddy bekommt kein Zertifikat | DNS zeigt nicht auf den Server oder Port 80/443 ist blockiert: `docker compose logs caddy` |
| Warnung „Externe Backup-Kopie fehlgeschlagen“ | Zielordner nicht beschreibbar: `sudo chown 1000:1000 <Pfad>` |
| „Sicherung ist verschlüsselt, aber OMEGA_BACKUP_PASSPHRASE ist nicht gesetzt“ | Passphrase in `.env` eintragen (dieselbe wie beim Erstellen) |
| `verify` meldet „nicht gefunden“ | Die zugehörige `.json`-Datei fehlt – mitkopieren (für `restore-offline` genügt die Sicherungsdatei allein) |
| `npm ci` scheitert beim Build hinter einem Firmen-Proxy mit eigener CA | `docker build --secret id=ca,src=/pfad/zur/ca.pem -t omega-infinity:latest .` und danach `docker compose up -d` |
| Build auf 32-Bit-ARM (z. B. Raspberry Pi mit 32-Bit-System) | `docker build --build-arg INSTALL_BUILD_TOOLS=true -t omega-infinity:latest .` – übersetzt SQLite aus dem Quellcode (ungetestet) |
| Port 4317 belegt | `OMEGA_LOCAL_PORT=8080` in `.env` |

## Was wurde geprüft?

In der Entwicklungsumgebung (Docker 29.9, Compose 5.6, linux/amd64) am 2026-11-06 tatsächlich ausgeführt:

| Schritt | Ergebnis |
|---|---|
| Image-Build (zweistufig, ohne Compiler) | erfolgreich; Laufzeit-Image ohne Entwicklungspakete, läuft als UID 1000 |
| `docker compose up -d`, Healthcheck | `healthy` nach wenigen Sekunden |
| Ersteinrichtung mit Code aus dem Log, Projekt anlegen, Web-App ausgeliefert | erfolgreich |
| Schreibschutz | `/app` nicht beschreibbar, `/data`, `/backups`, `/tmp` beschreibbar |
| Sicherung per Kommandozeile im Container, `verify` | verschlüsselt, verifiziert; keine temporären Dateien im Backup-Ordner |
| `docker compose restart` | Sicherung beim Herunterfahren erstellt, Daten danach vollständig vorhanden |
| Profil `https` mit `CADDY_TLS=internal` auf `localhost` | HTTPS 200, HTTP → HTTPS (308), HSTS/CSP vorhanden, kein `Server`-Header |
| Anmeldung über HTTPS (curl und Chromium) | Cookie `HttpOnly; Secure; SameSite=Strict`; fremde Origin → 403, fehlender CSRF-Header → 403; Oberfläche ohne Konsolenfehler |
| Caddy und `X-Forwarded-For` | gefälschter Header wird durch die echte Client-IP ersetzt, `Host` bleibt erhalten |
| Externe Backup-Kopie (Override-Datei) | Kopie + Metadaten im Host-Ordner, Prüfsumme bestätigt |
| Notfall-Wiederherstellung `restore-offline` | ohne Bestätigungs-Flag abgelehnt; mit Flag Daten zurückgesetzt, alte Datenbank aufbewahrt, alte Sitzung ungültig |
| `docker compose cp` in/aus dem Container | funktioniert trotz schreibgeschütztem Dateisystem |
| MCP-Server über `docker compose exec` | offizieller MCP-Client: 10 Werkzeuge, Werkzeugaufruf erfolgreich |
| Geheimnisse im Log | Secret-Key, Passphrase, Passwort und API-Token kommen in den Container-Logs nicht vor |

**Nicht geprüft:** Let's-Encrypt-Zertifikat mit echter Domain (keine öffentliche Domain verfügbar), Webhook-Zustellung
durch github.com, arm64-Hardware, Build mit `INSTALL_BUILD_TOOLS=true`, eigene Reverse-Proxys (nginx/Traefik),
Docker Desktop unter Windows/macOS. Der Build lief in dieser Umgebung mit Proxy-Build-Argumenten und `--secret id=ca`;
`docker compose up --build` nutzt dasselbe `Dockerfile`.
