output "url" {
  description = "Adresse der App."
  value       = local.public_url
}

output "saml_hinweis" {
  description = "Werte für die Entra-Unternehmensanwendung je Mandant (<kennung> = Mandanten-Kennung)."
  value = {
    entity_id = "${local.public_url}/saml/<kennung>"
    acs_url   = "${local.public_url}/saml/<kennung>/acs"
  }
}

output "resource_group" {
  value = azurerm_resource_group.this.name
}

output "image_tag" {
  value = var.image_tag
}
