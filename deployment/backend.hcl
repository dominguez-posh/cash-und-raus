# Gemeinsamer Speicher für den Terraform-State aller Umgebungen (angelegt mit bootstrap/).
# Der Schlüssel je Umgebung wird beim init übergeben: -backend-config="key=<umgebung>.tfstate"
resource_group_name  = "rg-cashundraus-tfstate"
storage_account_name = "stcashundraustfstate"
container_name       = "tfstate"
use_azuread_auth     = true
