# Produktivumgebung (Ausrollen bei Push auf main über GitHub Actions).
environment         = "prod"
location            = "westeurope"
resource_group_name = "rg-cashundraus-prod"
name                = "cashundraus-prod"

admin_user   = "notfall"
cpu          = 0.25
memory       = "0.5Gi"
min_replicas = 0 # 0 = schläft ohne Anfragen, 1 = läuft immer
