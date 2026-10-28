terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State je Umgebung im Azure Storage (siehe backend.hcl, Schlüssel <umgebung>.tfstate)
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    log_analytics_workspace {
      permanently_delete_on_destroy = true
    }
  }
  # null = aus ARM_SUBSCRIPTION_ID (Pipeline) bzw. subscription.auto.tfvars (lokal)
  subscription_id = var.subscription_id
}
