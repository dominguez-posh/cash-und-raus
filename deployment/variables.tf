variable "subscription_id" {
  description = "Ziel-Subscription. Nicht in envs/*.tfvars eintragen (öffentliches Repo): lokal in subscription.auto.tfvars, in der Pipeline über ARM_SUBSCRIPTION_ID."
  type        = string
  default     = null
}

variable "environment" {
  description = "Name der Umgebung (z. B. prod); wird als Tag gesetzt."
  type        = string
}

variable "location" {
  description = "Azure-Region."
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "Ressourcengruppe der Umgebung (wird angelegt)."
  type        = string
}

variable "name" {
  description = "Basisname, z. B. cashundraus-prod. Daraus entstehen Ressourcennamen und Adresse <name>.<zufall>.<region>.azurecontainerapps.io."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}[a-z0-9]$", var.name))
    error_message = "name: 3 bis 32 Zeichen, Kleinbuchstaben, Ziffern und Bindestriche, beginnt mit einem Buchstaben."
  }
}

variable "tags" {
  description = "Zusätzliche Tags für alle Ressourcen."
  type        = map(string)
  default     = {}
}

variable "image_repository" {
  description = "Container-Registry und Image (ohne Tag)."
  type        = string
  default     = "ghcr.io/dominguez-posh/cash-und-raus"
}

variable "image_tag" {
  description = "Image-Tag (Commit-SHA), kommt von der Pipeline. Nicht in tfvars eintragen."
  type        = string
  default     = null
}

variable "public_url" {
  description = "Öffentliche Adresse, falls eine eigene Domäne verwendet wird (z. B. https://kasse.firma.de). Leer = Adresse der Container App. Änderung ändert die SAML-Werte (Entity-ID, ACS-URL)!"
  type        = string
  default     = ""
}

variable "product_name" {
  description = "Produktname in der Oberfläche und in der Authenticator-App."
  type        = string
  default     = "Cash & Raus"
}

variable "admin_user" {
  description = "Benutzername des ersten lokalen Admin-Kontos (wird nur angelegt, solange es noch kein lokales Konto gibt)."
  type        = string
  default     = "notfall"
}

variable "admin_password" {
  description = "Startpasswort des ersten lokalen Admin-Kontos (mind. 12 Zeichen). Kommt aus dem GitHub-Secret CR_ADMIN_PASSWORD."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cpu" {
  description = "vCPU (0.25, 0.5, 0.75 oder 1)."
  type        = number
  default     = 0.25
}

variable "memory" {
  description = "Arbeitsspeicher passend zur vCPU (0.25 -> 0.5Gi, 0.5 -> 1Gi, 0.75 -> 1.5Gi, 1 -> 2Gi)."
  type        = string
  default     = "0.5Gi"
}

variable "min_replicas" {
  description = "0 = schläft ohne Anfragen (günstig, erster Aufruf danach dauert einige Sekunden); 1 = läuft immer. Wegen SQLite läuft höchstens eine Instanz."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1], var.min_replicas)
    error_message = "min_replicas muss 0 oder 1 sein (SQLite: genau eine Instanz)."
  }
}

variable "session_hours" {
  description = "Höchstdauer einer Anmeldung in Stunden."
  type        = number
  default     = 12
}

variable "data_share_quota_gb" {
  description = "Größe der Dateifreigabe für die Datenbanken in GB."
  type        = number
  default     = 5
}

variable "log_daily_quota_gb" {
  description = "Tageslimit der Protokolle in GB (Kostenbremse)."
  type        = number
  default     = 0.2
}
