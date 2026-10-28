# Deployment (Azure Container Apps, Terraform, GitHub Actions)

Aufbau wie bei hrdnr: einmalig `bootstrap/` lokal ausführen, danach rollt jeder Push auf `main` über
GitHub Actions aus (`.github/workflows/deploy.yml` → `terraform-env.yml`). Anmeldung an Azure per OIDC, ohne Client-Secret.

## Ressourcen je Umgebung

| Ressource | Zweck | Kosten (ca.) |
| --- | --- | --- |
| Container App (Consumption, 0,25 vCPU / 0,5 GiB, max. 1 Instanz) | App | `min_replicas = 0`: fast 0 €; `= 1`: ca. 3–15 €/Monat |
| Container Apps Environment | Umgebung | 0 € |
| Storage Account + Dateifreigabe `data` (5 GB) | SQLite-Datenbanken | < 1 €/Monat |
| Log Analytics (Tageslimit 0,2 GB) | Protokolle | wenige €/Monat |

Bootstrap: Storage Account für den State (Cent-Bereich) und eine Managed Identity (kostenlos).

## Einmalig: Bootstrap

Voraussetzung: Azure CLI, Terraform ≥ 1.6, **Owner** auf der Subscription.

```powershell
az login
cd deployment/bootstrap
copy terraform.tfvars.example terraform.tfvars   # subscription_id eintragen
terraform init
terraform apply
terraform output github_secrets
```

Der State des Bootstraps bleibt lokal (`bootstrap/terraform.tfstate`, nicht eingecheckt) – gut aufheben.

## GitHub einrichten

1. **Secrets** (Settings → Secrets and variables → Actions → Repository secrets):
   - `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` aus `terraform output github_secrets`
   - `CR_ADMIN_PASSWORD`: Startpasswort des Notfallkontos `notfall` (mind. 12 Zeichen, Buchstaben + Ziffern/Sonderzeichen)
2. **Environment** `prod` (Settings → Environments): optional „Required reviewers“ setzen, dann wartet jedes Ausrollen auf Freigabe.
3. Nach dem ersten Lauf: **Packages → cash-und-raus → Package settings**: Sichtbarkeit *public*, damit die Container App das Image
   ohne Anmeldung ziehen kann (wie bei hrdnr).

## Erster Start

1. Adresse aus dem Workflow (Zusammenfassung) öffnen → „Admin- / Notfallzugang“ → `notfall` + Startpasswort.
2. Zweiten Faktor einrichten (Authenticator-App oder Passkey), Wiederherstellungscodes sicher ablegen.
3. Mein Konto → Passwort ändern. Das Secret `CR_ADMIN_PASSWORD` wird danach nicht mehr verwendet
   (das Konto wird nur angelegt, solange es noch kein lokales Konto gibt).
4. Plattform → Neuer Mandant (Kennung, Name, erster Admin mit Firmen-E-Mail).
5. Mandant → Einstellungen: Entity-ID und ACS-URL in Entra eintragen (siehe unten), Metadaten-URL zurück übernehmen,
   E-Mail-Domäne eintragen, „Firmenanmeldung aktiv“.

## Entra: SAML-Unternehmensanwendung je Mandant

1. Entra Admin Center → Unternehmensanwendungen → Neue Anwendung → Eigene Anwendung erstellen
   („Nicht im Katalog enthaltene Anwendung“), Name z. B. „Cash & Raus“.
2. Einmaliges Anmelden → SAML → Grundlegende SAML-Konfiguration:
   - Bezeichner (Entitäts-ID): `https://<adresse>/saml/<kennung>`
   - Antwort-URL (ACS): `https://<adresse>/saml/<kennung>/acs`
3. Attribute & Ansprüche: Standard genügt (Eindeutiger Benutzerbezeichner = `user.userprincipalname`).
   Die App erkennt Benutzer an UPN oder E-Mail und bindet sie beim ersten Login an die Entra-Objekt-ID.
4. SAML-Zertifikate → **App-Verbundmetadaten-URL** kopieren → in Cash & Raus unter Plattform → Mandant → „Metadaten laden“.
5. Benutzer und Gruppen: die Mitarbeiter (oder eine Gruppe) zuweisen. Zusätzlich muss jeder Benutzer in
   Cash & Raus unter Verwaltung → Benutzer angelegt sein (Rollen, Filialen).

## Eigene Domäne (später)

`public_url` in `envs/prod.tfvars` setzen und die Domäne an der Container App einrichten. Achtung: Entity-ID und ACS-URL
ändern sich mit der Adresse, also auch in Entra anpassen. Passkeys gelten je Domäne und müssen neu eingerichtet werden.

## Daten und Sicherung

- Datenbanken: `/data/plattform.sqlite` und `/data/mandanten/<kennung>.sqlite` auf der Dateifreigabe `data`.
- Gelöschte Dateien sind 14 Tage wiederherstellbar (Soft Delete). Für regelmäßige Sicherungen die Freigabe in
  Azure Backup aufnehmen (Recovery Services Vault, Richtlinie für Azure Files).
- Höchstens eine Instanz (`max_replicas = 1`): SQLite verträgt nur einen Schreiber.

## Neue Einstellung

Immer als Variable mit Beschreibung in `variables.tf` anlegen und hier dokumentieren.
