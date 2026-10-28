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
