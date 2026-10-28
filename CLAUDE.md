# Cash & Raus

Mandantenfähige Web-App für Verkauf, Lieferung, Lager und Kasse in Filialbetrieben; löst ein Excel/VBA-System ab.
Plan, Entscheidungen und Stufen: `docs/PLAN.md`. Deployment: `deployment/README.md`.

| Teil | Ort | Technik |
| --- | --- | --- |
| Web-App | `src/`, `public/` | React 19 + TypeScript, esbuild, handgeschriebenes CSS (`public/app.css`) |
| Server | `server/src/` | Node.js 24, Fastify, Kysely + better-sqlite3 |
| Gemeinsame Typen | `shared/types.ts` | von Server und Web-App verwendet |
| Tests | `server/test/` | `node --test` mit `fastify.inject` |
| Deployment | `deployment/`, `.github/workflows/` | Terraform, GitHub Actions (OIDC), Azure Container Apps |

## Regeln

- Das GitHub-Repo `dominguez-posh/cash-und-raus` ist **öffentlich**. Niemals Kundendaten, Mitarbeiternamen,
  Logos von Kunden, Steuernummern, Tenant-/Subscription-IDs oder Secrets committen.
- `Backup-C-Start/` (Altsystem mit echten Daten) bleibt lokal und ist per `.gitignore` ausgeschlossen.
  Testdaten daraus nur anonymisiert verwenden.
- Commit/Push nur auf Anweisung. **Ein Push auf `main` rollt prod aus** (sofern in GitHub kein Reviewer am Environment `prod` hängt).
- Vor jedem Commit: `npm run typecheck`, `npm test` und `npm run build` fehlerfrei.
- Migrationen (`server/src/db/migrationen.ts`) nur anhängen, nie bestehende ändern (seit dem ersten Deployment).
- Protokolltabellen sind unveränderlich (Trigger); Stammdaten werden deaktiviert, nicht gelöscht (GoBD).
- Genau eine Server-Instanz (SQLite). Kosten neuer Azure-Ressourcen vorab nennen.
- `server/src/auth/totp.ts` und `webauthn.ts` stammen aus hrdnr; Fehlerbehebungen dort ggf. übernehmen.

## Anmeldung

- Mitarbeiter: SAML2 je Mandant (`/saml/<kennung>/login|acs|metadata`), Konfiguration in der Plattform-DB.
- Admin/Notfall: lokales Konto (Plattform-Admin), Passwort + TOTP oder Passkey Pflicht. Das erste Konto legt die
  Ersteinrichtung beim ersten Öffnen an (`/api/auth/einrichtung`, nur solange kein lokales Konto existiert).
- Plattform-Admins können einen Mandanten „betreuen“ (Admin-Rolle im Mandanten, wird protokolliert).

## Stand

- 2026-10-28: Altsystem analysiert, Plan abgestimmt.
- 2026-10-28: Stufe 1 gebaut (SAML, lokaler Admin mit MFA, Mandanten, Filialen mit IP-Erkennung, Benutzer, Branding,
  Terraform + Workflows). Tests grün. Noch nicht committet/ausgerollt; SAML noch nicht gegen echtes Entra getestet.
- 2026-10-28: Stufe 2 gebaut (ohne E-Mail = 2b): Verkauf in Schritten (`src/seiten/Verkauf.tsx`), Vorgang/Suche
  (`Vorgang.tsx`), Logik `server/src/verkauf.ts`, PDFs `server/src/pdf.ts` (pdfmake 0.3.11, nur Standardschriften),
  Berechnung gemeinsam in `shared/verkauf.ts`, Migration 2 (vorgang, zahlung, dokument, nummernkreis). Tests grün.
  Offen: PDF-Layout mit echten Firmendaten prüfen, Bedienung auf dem iPad testen.
- 2026-10-28: Stufe 2b: E-Mail über Microsoft Graph (`server/src/email.ts`), Client-Secret verschlüsselt mit
  `CR_SECRET_KEY` (`geheim.ts`, Terraform `random_password`). Je Mandant: App-Registrierung mit Mail.Send nötig.
- 2026-10-28: Stufe 3 Kasse: `shared/kasse.ts`, `server/src/kasse.ts`, `routen/kasse.ts`, `src/seiten/Kasse.tsx`.
  Wechselgeld je Filiale als Anfangsbestand; Soll = Wechselgeld + Barzahlungen (Verkauf) + Belege; Belege nur per
  Gegenbeleg korrigierbar; Abschluss je Filiale/Tag unveränderlich, sperrt weitere Belege. Migration 4.
