# Einmalige Grundausstattung, lokal ausgeführt (lokaler State, nicht einchecken):
# - Speicher für den Terraform-State aller Umgebungen
# - Managed Identity für GitHub Actions mit Federated Credentials je Umgebung (OIDC, ohne Secret).
#   Braucht Owner-Rechte auf der Subscription (Rollenzuweisung), keine Rechte im Entra-Tenant.

terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

variable "subscription_id" {
  description = "Ziel-Subscription."
  type        = string
}

variable "location" {
  description = "Region des State-Speichers."
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "Ressourcengruppe des State-Speichers (muss zu ../backend.hcl passen)."
  type        = string
  default     = "rg-cashundraus-tfstate"
}

variable "storage_account_name" {
  description = "Storage Account für den State, weltweit eindeutig (muss zu ../backend.hcl passen)."
  type        = string
  default     = "stcashundraustfstate"
}

variable "github_repository" {
  description = "GitHub-Repository als <owner>/<repo>."
  type        = string
  default     = "dominguez-posh/cash-und-raus"
}

variable "github_repository_ids" {
  description = <<-EOT
    Unveränderliche IDs als <owner>@<owner-id>/<repo>@<repo-id> (https://api.github.com/repos/<owner>/<repo>: owner.id, id).
    GitHub sendet je nach Einstellung "repo:<owner>/<repo>" oder dieses Format; es werden Credentials für beide angelegt.
  EOT
  type        = string
  default     = "dominguez-posh@9081611/cash-und-raus@1437081625"
}

variable "environments" {
  description = "GitHub-Umgebungen, die nach Azure ausrollen dürfen."
  type        = list(string)
  default     = ["prod"]
}

data "azurerm_client_config" "current" {}
data "azurerm_subscription" "current" {}

resource "azurerm_resource_group" "state" {
  name     = var.resource_group_name
  location = var.location
  tags     = { workload = "cash-und-raus", environment = "shared" }
}

resource "azurerm_storage_account" "state" {
  name                            = var.storage_account_name
  resource_group_name             = azurerm_resource_group.state.name
  location                        = azurerm_resource_group.state.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = true
  tags                            = azurerm_resource_group.state.tags

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 14
    }
    container_delete_retention_policy {
      days = 14
    }
  }
}

resource "azurerm_storage_container" "state" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
}

# Zugriff auf den State per Entra ID für die angemeldete Person (lokale Ausführung)
resource "azurerm_role_assignment" "state_current_user" {
  scope                = azurerm_storage_account.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

# ------------------------------------------------------------ GitHub Actions

resource "azurerm_user_assigned_identity" "github" {
  name                = "id-cashundraus-github"
  resource_group_name = azurerm_resource_group.state.name
  location            = azurerm_resource_group.state.location
  tags                = azurerm_resource_group.state.tags
}

locals {
  subjects = merge([
    for env in var.environments : {
      "github-${env}"     = "repo:${var.github_repository}:environment:${env}"
      "github-${env}-ids" = "repo:${var.github_repository_ids}:environment:${env}"
    }
  ]...)
}

resource "azurerm_federated_identity_credential" "env" {
  for_each                  = local.subjects
  name                      = each.key
  user_assigned_identity_id = azurerm_user_assigned_identity.github.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = each.value
}

# Legt Ressourcengruppen und Ressourcen der Umgebungen an
resource "azurerm_role_assignment" "github_contributor" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "github_state" {
  scope                = azurerm_storage_account.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
  principal_type       = "ServicePrincipal"
}

output "github_secrets" {
  description = "Als Repository-Secrets in GitHub hinterlegen (Settings > Secrets and variables > Actions)."
  value = {
    AZURE_CLIENT_ID       = azurerm_user_assigned_identity.github.client_id
    AZURE_TENANT_ID       = data.azurerm_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID = data.azurerm_client_config.current.subscription_id
  }
}
