# Cash & Raus – Plan

Ablösung des Excel/VBA-Systems (`Backup-C-Start`, lokal, nicht im Repo) durch eine mandantenfähige Web-App
für Verkauf, Lieferung, Lager und Kasse in Filialbetrieben.

## Altsystem (Kurzfassung)

Excel-Dateien mit VBA unter `C:\CR\` je Arbeitsplatz:

| Datei | Funktion |
| --- | --- |
| `CR_Anfangen.xls` | Startmenü: Rechnung erstellen/ansehen, Restzahlung, Storno (Tagespasswort), Namenssuche, Beleg, Kassenabrechnung, Mail an Dispo |
| `CR_Verkauf.xls` | Vorlage Vorgang: Sachbearbeiter, Zahlungsart, Lieferart, Liefertag/-zeit, Lieferkosten, Montage, Wagen, Etage, Kunde, abweichende Rechnungsanschrift, 11 Positionen (Lagerort je Position, 2 Kennzeichen), Kürzel `DP` (−30 %) / `FMK` (−15 %); Blätter Rechnung, Lieferschein, Kommission |
| `CR_Kasse.xls` | Tageskasse laut Z-Abschlag, Zählprotokoll Scheine/Münzen, Wechselgeld, Soll/Ist, Übergabe |
| `CR_Belege.xls` | Kassenbelege mit Grund (Einzahlung Bank, EC-cash, Tanken Wagen, Einkauf …) |
| `CR_Namen.xls` | Stammdaten Sachbearbeiter/Gründe, Zähler zurücksetzen |
| `CR_Rechnung nach Namen.xls` | Suche über alle Rechnungsdateien nach Kundenname |
| `CR_Zaehler1.xls` | Rechnungszähler |

Rechnungsnummer `Filiale-Nr-JJ` (z. B. `B-1-26`), EC-Zahlung mit Suffix `ec`. Jede Rechnung ist eine eigene Datei.
USt 7 %. Entfernungsaufschlag (ab 13 km 1,40 €/km) war geplant, ist im Code deaktiviert.

## Entscheidungen

| Thema | Entscheidung |
| --- | --- |
| Anmeldung Mitarbeiter | SAML2 je Mandant (Entra-Unternehmensanwendung); Zuordnung über E-Mail-Domäne, Bindung an Entra-Objekt-ID |
| Anmeldung Admin/Notfall | Lokales Konto: Passwort + Pflicht-MFA (TOTP oder Passkey), Wiederherstellungscodes; erstes Konto über die Ersteinrichtung beim ersten Öffnen |
| Filiale | Automatisch über IP-Bereich der Filiale, sonst Auswahl aus den erlaubten Filialen |
| Mandanten | Code mandantenfähig; Betrieb als eine Instanz für alle **oder** eine Instanz je Kunde |
| Datenbank | SQLite: Plattform-DB + eine DB-Datei je Mandant; Zugriff über Kysely (Wechsel zu Postgres möglich) |
| Speicherort | Azure Files (`/data`), Journal DELETE, Mount-Option `nobrl`, genau eine Instanz; Sicherung über Soft Delete + Azure Backup |
| Kasse | Zuerst Abgleich mit der echten TSE-Kasse (Bon-Nr., Z-Bon); Datenmodell so, dass eine Cloud-TSE später nachrüstbar ist |
| Ausgabe | PDF (Server), Drucken-Button, E-Mail (Graph `sendMail`, alternativ SMTP) |
| Altdaten | Import der `.xls`-Rechnungen; echte Daten nur lokal, Testdaten anonymisiert |
| Hosting | Direkt Azure Container Apps (Terraform, GitHub Actions mit OIDC, Image auf ghcr.io); lokal `npm run dev` |
| Repo | Öffentlich: keine Kundendaten, Logos, IDs oder Secrets committen |

## Architektur

| Teil | Technik |
| --- | --- |
| Web-App | React 19 + TypeScript, esbuild, handgeschriebenes CSS |
| Server | Node.js 24 + TypeScript, Fastify, Kysely + better-sqlite3 |
| Auth | `@node-saml/node-saml` (SAML2), TOTP/WebAuthn aus hrdnr übernommen, Sitzungen in der Plattform-DB (nur SHA-256 des Cookies) |
| PDF | pdfmake |
| Karte | Leaflet + OpenStreetMap, Routing OpenRouteService/OSRM |
| Container | ein Image, eine Instanz je Umgebung (SQLite) |

## Rollen

- **Plattform-Admin**: Mandanten anlegen, Entra-Tenant zuordnen, Betriebsart.
- **Mandanten-Admin**: Firmendaten, Logo, Filialen (inkl. IP-Bereiche), Benutzer und Rollen, Stammdaten.
- **Filialleitung**, **Verkauf**, **Dispo**, **Lager**, **Fahrer**.

## Datenmodell (Kern)

- Plattform-DB: `mandant`, `mandant_entra_tenant`, `plattform_admin`
- Mandanten-DB:
  - `einstellungen` (Firmendaten, Logo, Steuernr., Bank, Fußtexte, USt-Sätze, Nummernformat, Rabattarten)
  - `filiale` (Kürzel, Adresse, Kontakt, IP-Bereiche), `lagerort`
  - `benutzer` (Entra-Objekt-ID), `benutzer_rolle`, `benutzer_filiale`
  - `kunde`, `kunde_adresse`
  - `artikel`, `bestand`, `lagerbuchung`
  - `vorgang` (Status Entwurf → festgeschrieben; Storno/Restzahlung als eigener Vorgang mit Bezug), `vorgang_position`, `zahlung` (inkl. Kassen-Bon-Nr.)
  - `nummernkreis` (lückenlos, in Transaktion vergeben)
  - `lieferauftrag`, `tour`, `tour_stopp`, `fahrzeug` (inkl. Tracker-ID für später)
  - `kassenbeleg`, `kassenabschluss` (Zählprotokoll, Z-Bon-Summe, Differenz)
  - `protokoll` (Person, Zeit, Aktion, Objekt; unveränderlich)
  - `dokument` (archivierte PDFs)

## Stufen

1. **Grundgerüst**: Repo-Struktur, SAML-Login, lokaler Admin mit MFA, Plattform-/Mandanten-Admin, Filialen mit IP-Erkennung, Benutzer, Branding, Deployment.
2. **Verkauf**: Vorgang mit allen Feldern des Altsystems, Anzahlung/Restzahlung, Storno, Rabatte, PDF (Rechnung, Lieferschein, Kommission), Drucken, E-Mail, Suche.
3. **Kasse**: Belege, Tagesabschluss mit Zählprotokoll, Abgleich Z-Bon.
4. **Import**: Altrechnungen aus `.xls`.
5. **Artikel und Lager**: Bestand je Lagerort, Abbuchung beim Festschreiben, Umlagerung, Inventur.
6. **Dispo und Touren**: Lieferkalender, Touren je Fahrzeug auf der Karte, Lieferkosten nach Entfernung, Tourenzettel.
7. **Später**: GPS-Tracker (z. B. Traccar), Live-Position, Tour als Navi-Link an Fahrer, Cloud-TSE (z. B. fiskaly) mit DSFinV-K-Export.

## Rechtliches im Blick behalten

- GoBD: festgeschriebene Vorgänge unveränderlich, Korrektur nur per Storno, Protokoll, 10 Jahre Aufbewahrung.
- Rechnungspflichtangaben (§ 14 UStG), ab 2027/2028 E-Rechnung im B2B (XRechnung/ZUGFeRD) einplanen.
- Eigene Kassenfunktion erst mit TSE (KassenSichV, Belegausgabepflicht, Meldung nach § 146a AO).
- DSGVO: Kundendaten je Mandant getrennt, Löschkonzept nach Ablauf der Aufbewahrung.
