terraform {
  required_version = ">= 1.13"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  backend "gcs" {
    bucket = "" # Set via -backend-config during terraform init
    prefix = "terraform/infra"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

data "google_project" "project" {
  project_id = var.project_id
}

resource "google_project_iam_member" "cloud_run_secret_access" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

locals {
  project_name = trimprefix(var.project_id, "ai2-skiff2-")

  # Prod (main branch) services — keys where deployment_environment is "prod"
  prod_services = {
    for key, svc in var.services : key => svc if svc.deployment_environment == "prod"
  }

  # Branch (non-prod) services
  branch_services = {
    for key, svc in var.services : key => svc if svc.deployment_environment != "prod"
  }

  # Non-default prod services (for subdomain routing)
  non_default_prod_services = {
    for key, svc in local.prod_services : key => svc if key != var.default_service
  }

  # Exclude allow_delete services from the URL map (prevents bug where deleting a service errors because the url map prevents the backend from being deleted)
  url_map_non_default_prod_services = {
    for key, svc in local.non_default_prod_services : key => svc if !svc.allow_delete
  }

  url_map_branch_services = {
    for key, svc in local.branch_services : key => svc if !svc.allow_delete
  }

  # Distinct branch names (non-prod)
  branch_names = distinct([for _, svc in local.branch_services : svc.deployment_environment])

  # Default service key per branch (first service found for each branch)
  branch_default_keys = {
    for branch in local.branch_names : branch => [
      for key, svc in local.branch_services : key if svc.deployment_environment == branch
    ][0]
  }

  # Non-default branch services (for branch subdomain routing)
  non_default_branch_services = {
    for key, svc in local.url_map_branch_services : key => svc
    if key != lookup(local.branch_default_keys, svc.deployment_environment, "")
  }

  # All domains for the SSL certificate
  all_domains = concat(
    # pandajungle.org — prod
    ["${local.project_name}.pandajungle.org"],
    [for key, _ in local.non_default_prod_services : "${_.name}.${local.project_name}.pandajungle.org"],

    # apps.allenai.org and allen.ai — prod
    ["${local.project_name}.allen.ai", "${local.project_name}.apps.allenai.org"],
    [for key, _ in local.non_default_prod_services : "${_.name}.${local.project_name}.allen.ai"],
    [for key, _ in local.non_default_prod_services : "${_.name}.${local.project_name}.apps.allenai.org"],

    # Branch domains — branch.project.pandajungle.org for default service per branch
    [for branch in local.branch_names : "${branch}.${local.project_name}.pandajungle.org"],
    [for branch in local.branch_names : "${branch}.${local.project_name}.allen.ai"],
    [for branch in local.branch_names : "${branch}.${local.project_name}.apps.allenai.org"],

    # Branch domains — branch.service.project.pandajungle.org for non-default services
    [for key, svc in local.non_default_branch_services : "${svc.deployment_environment}.${svc.name}.${local.project_name}.pandajungle.org"],
    [for key, svc in local.non_default_branch_services : "${svc.deployment_environment}.${svc.name}.${local.project_name}.allen.ai"],
    [for key, svc in local.non_default_branch_services : "${svc.deployment_environment}.${svc.name}.${local.project_name}.apps.allenai.org"],

    # Per-service custom domains (prod only)
    flatten([for _, svc in local.prod_services : svc.custom_domains]),
  )
}

data "google_compute_global_address" "lb_ip" {
  name    = "${local.project_name}-lb-ip"
  project = var.project_id
}

data "google_compute_security_policy" "cloud_armor" {
  name    = "skiff2-cloud-armor"
  project = var.project_id
}

resource "google_compute_region_network_endpoint_group" "default" {
  for_each              = var.services
  name                  = "${each.value.deployment_environment}-${each.value.name}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id
  cloud_run {
    service = "${each.value.deployment_environment}-${each.value.name}"
  }
}

# Custom URL map with host-based routing for service subdomains
resource "google_compute_url_map" "default" {
  name    = "${local.project_name}-url-map"
  project = var.project_id

  # Default service handles project_name.pandajungle.org and any unmatched hosts
  # NOTE: We construct self_links manually instead of referencing module.lb-http.backend_services[...].self_link
  # to avoid an implicit Terraform dependency that causes GCP to reject backend deletion before the URL map is updated.
  default_service = "projects/${var.project_id}/global/backendServices/default-lb-backend-default"

  # Route each non-default prod service's subdomain to its backend
  dynamic "host_rule" {
    for_each = local.url_map_non_default_prod_services
    content {
      hosts = concat(
        [
          "${host_rule.value.name}.${local.project_name}.pandajungle.org",
          "${host_rule.value.name}.${local.project_name}.allen.ai",
          "${host_rule.value.name}.${local.project_name}.apps.allenai.org",
        ],
        host_rule.value.custom_domains,
      )
      path_matcher = host_rule.key
    }
  }

  dynamic "path_matcher" {
    for_each = local.url_map_non_default_prod_services
    content {
      name            = path_matcher.key
      default_service = module.lb-http.backend_services[path_matcher.key].self_link
    }
  }

  # Route branch default service: branch.project.pandajungle.org
  dynamic "host_rule" {
    for_each = local.branch_default_keys
    content {
      hosts = [
        "${host_rule.key}.${local.project_name}.pandajungle.org",
        "${host_rule.key}.${local.project_name}.allen.ai",
        "${host_rule.key}.${local.project_name}.apps.allenai.org",
      ]
      path_matcher = "branch-${host_rule.key}"
    }
  }

  dynamic "path_matcher" {
    for_each = local.branch_default_keys
    content {
      name            = "branch-${path_matcher.key}"
      default_service = module.lb-http.backend_services[path_matcher.value].self_link
    }
  }

  # Route branch non-default services: branch.service.project.pandajungle.org
  dynamic "host_rule" {
    for_each = local.non_default_branch_services
    content {
      hosts = [
        "${host_rule.value.deployment_environment}.${host_rule.value.name}.${local.project_name}.pandajungle.org",
        "${host_rule.value.deployment_environment}.${host_rule.value.name}.${local.project_name}.allen.ai",
        "${host_rule.value.deployment_environment}.${host_rule.value.name}.${local.project_name}.apps.allenai.org",
      ]
      path_matcher = host_rule.key
    }
  }

  dynamic "path_matcher" {
    for_each = local.non_default_branch_services
    content {
      name            = path_matcher.key
      default_service = "projects/${var.project_id}/global/backendServices/default-lb-backend-${path_matcher.key}"
    }
  }
}

resource "google_certificate_manager_certificate_map" "default" {
  name    = "${local.project_name}-cert-map"
  project = var.project_id
}

resource "google_certificate_manager_certificate" "default" {
  for_each = toset(local.all_domains)
  name     = "${local.project_name}-cert-${replace(each.value, ".", "-")}"
  project  = var.project_id

  managed {
    domains = [each.value]
  }
}

resource "google_certificate_manager_certificate_map_entry" "default" {
  for_each     = toset(local.all_domains)
  name         = "${local.project_name}-entry-${replace(each.value, ".", "-")}"
  project      = var.project_id
  map          = google_certificate_manager_certificate_map.default.name
  certificates = [google_certificate_manager_certificate.default[each.value].id]
  hostname     = each.value
}

module "lb-http" {
  source  = "GoogleCloudPlatform/lb-http/google//modules/serverless_negs"
  version = "~> 12.0"

  name    = "default-lb"
  project = var.project_id

  load_balancing_scheme = "EXTERNAL_MANAGED"

  create_address = false
  address        = data.google_compute_global_address.lb_ip.address

  ssl             = true
  certificate_map = google_certificate_manager_certificate_map.default.id
  https_redirect  = true


  create_url_map = false
  url_map        = google_compute_url_map.default.self_link

  backends = {
    for key, svc in var.services : (key == var.default_service ? "default" : key) => {
      protocol        = "HTTPS"
      enable_cdn      = false
      security_policy = data.google_compute_security_policy.cloud_armor.self_link

      log_config = {
        enable      = true
        sample_rate = 1.0
      }

      groups = [
        {
          group = google_compute_region_network_endpoint_group.default[key].id
        }
      ]

      iap_config = {
        enable = false
      }
    }
  }
}
