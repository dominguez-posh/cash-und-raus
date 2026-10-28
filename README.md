# Cash & Raus

Web-App für Verkauf, Lieferung, Lager und Kasse in Filialbetrieben – mandantenfähig, Anmeldung per SAML2
(z. B. Microsoft Entra ID), Filialerkennung über IP-Adressen.

## Lokal starten

```powershell
npm install
npm run dev        # http://localhost:3000
```

Beim ersten Öffnen legt die Ersteinrichtung das Admin-Konto an; danach wird der zweite Faktor eingerichtet.
Daten liegen unter `data/` (nicht eingecheckt).

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Server mit Neustart bei Änderungen, Web-App wird mitgebaut |
| `npm run typecheck` | TypeScript prüfen |
| `npm test` | Tests |
| `npm run build` | Produktions-Build nach `dist/` |

Deployment nach Azure: [deployment/README.md](deployment/README.md). Plan: [docs/PLAN.md](docs/PLAN.md).

## Einrichtung nach dem ersten Start

1. Beim ersten Öffnen das Admin-Konto anlegen (Passwort + TOTP/Passkey).
2. Plattform → Mandanten: Mandanten anlegen, „Betreuen“, unter Verwaltung Firmendaten, Filialen (mit Adresse, IP-Bereichen,
   Wechselgeld), Benutzer und Rollen, USt-Sätze, Rabattarten, Lieferzeiten, Lieferkosten eintragen.
3. Firmenanmeldung (Microsoft 365): Plattform → Entra-Setup-App einmalig eine mandantenfähige App-Registrierung des Plattform-
   Tenants hinterlegen (Umleitungs-URI aus der Anzeige, delegierte Graph-Berechtigungen `Application.ReadWrite.All`,
   `Domain.Read.All`). Danach im Mandanten „Mit Microsoft verbinden“: Der Entra-Admin des Mandanten meldet sich an, die
   Unternehmensanwendung wird automatisch angelegt. Dafür muss `CR_SECRET_KEY` gesetzt sein (Terraform erledigt das).
4. E-Mail-Versand (optional): Verwaltung → E-Mail, App-Registrierung im Tenant des Mandanten mit `Mail.Send` (Anwendung).
5. Altrechnungen: Verwaltung → Import (`.xls`-Dateien, erst prüfen).

## Externe Dienste

| Zweck | Dienst | Einstellung |
| --- | --- | --- |
| Adressen → Koordinaten | Nominatim (OpenStreetMap), eine Anfrage je Sekunde, Ergebnisse werden je Mandant zwischengespeichert | `CR_GEOCODE_URL` |
| Routen und Entfernung | OSRM-Demo-Server (nur für geringe Nutzung gedacht) | `CR_ROUTING_URL` (eigener OSRM oder kompatibler Dienst) |
| Karte | OpenStreetMap-Kacheln (in der CSP freigegeben) | – |
| E-Mail, Entra-Einrichtung | Microsoft Graph | Verwaltung → E-Mail, Plattform → Entra-Setup-App |
