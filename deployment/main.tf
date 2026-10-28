# Cash & Raus in Azure Container Apps. Die SQLite-Datenbanken liegen auf Azure Files (/data).
# SQLite verträgt nur einen Schreiber: deshalb höchstens eine Instanz, Journal DELETE statt WAL
# und die Mount-Option nobrl (sonst scheitern die Dateisperren über SMB).

locals {
  tags       = merge({ workload = "cash-und-raus", environment = var.environment }, var.tags)
  public_url = var.public_url != "" ? trimsuffix(var.public_url, "/") : "https://${var.name}.${azurerm_container_app_environment.this.default_domain}"
}

resource "azurerm_resource_group" "this" {
  name     = var.resource_group_name
  location = var.location
  tags     = local.tags
}

resource "terraform_data" "image_tag_check" {
  lifecycle {
    precondition {
      condition     = var.image_tag != null
      error_message = "image_tag fehlt: über die Pipeline ausrollen (oder -var image_tag=<sha>)."
    }
  }
}

resource "random_string" "storage_suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_storage_account" "data" {
  name                            = substr("st${replace(var.name, "-", "")}${random_string.storage_suffix.result}", 0, 24)
  resource_group_name             = azurerm_resource_group.this.name
  location                        = azurerm_resource_group.this.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  tags                            = local.tags

  # gelöschte Freigaben/Dateien 14 Tage wiederherstellbar
  share_properties {
    retention_policy {
      days = 14
    }
  }
}

resource "azurerm_storage_share" "data" {
  name               = "data"
  storage_account_id = azurerm_storage_account.data.id
  quota              = var.data_share_quota_gb
}

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-${var.name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = var.log_daily_quota_gb
  tags                = local.tags
}

resource "azurerm_container_app_environment" "this" {
  name                       = "cae-${var.name}"
  resource_group_name        = azurerm_resource_group.this.name
  location                   = azurerm_resource_group.this.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  tags                       = local.tags
}

resource "azurerm_container_app_environment_storage" "data" {
  name                         = "data"
  container_app_environment_id = azurerm_container_app_environment.this.id
  account_name                 = azurerm_storage_account.data.name
  share_name                   = azurerm_storage_share.data.name
  access_key                   = azurerm_storage_account.data.primary_access_key
  access_mode                  = "ReadWrite"
}

resource "azurerm_container_app" "this" {
  name                         = var.name
  resource_group_name          = azurerm_resource_group.this.name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"
  tags                         = local.tags

  template {
    min_replicas = var.min_replicas
    max_replicas = 1

    container {
      name   = "app"
      image  = "${var.image_repository}:${coalesce(var.image_tag, "-")}"
      cpu    = var.cpu
      memory = var.memory

      env {
        name  = "CR_BEHIND_TLS_PROXY"
        value = "1"
      }
      env {
        name  = "CR_PUBLIC_URL"
        value = local.public_url
      }
      env {
        name  = "CR_SQLITE_JOURNAL"
        value = "DELETE"
      }
      env {
        name  = "CR_PRODUCT_NAME"
        value = var.product_name
      }
      env {
        name  = "CR_SESSION_HOURS"
        value = tostring(var.session_hours)
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/healthz"
      }

      volume_mounts {
        name = "data"
        path = "/data"
      }
    }

    volume {
      name          = "data"
      storage_type  = "AzureFile"
      storage_name  = azurerm_container_app_environment_storage.data.name
      mount_options = "uid=1000,gid=1000,dir_mode=0700,file_mode=0600,nobrl"
    }
  }

  ingress {
    external_enabled           = true
    target_port                = 8080
    transport                  = "http"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  depends_on = [terraform_data.image_tag_check]
}
