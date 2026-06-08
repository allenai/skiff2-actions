terraform {
  required_version = ">= 1.13"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.0"
    }
  }

  backend "gcs" {
    bucket = "" # Set via -backend-config during terraform init
    prefix = "terraform/services"
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

module "cloud_run_service" {
  for_each = var.services
  source   = "./modules/cloud_run_service"
  providers = {
    google      = google
    google-beta = google-beta
  }

  service_name            = each.value.name
  service_containers      = each.value.containers
  project_id              = var.project_id
  project_number          = data.google_project.project.number
  region                  = var.region
  deployment_environment  = var.deployment_environment
  image_tag               = var.image_tag
  min_instances           = each.value.min_instances
  max_instances           = each.value.max_instances
  request_timeout_seconds = each.value.request_timeout_seconds
  max_concurrent_requests = each.value.max_concurrent_requests
  allow_delete            = each.value.allow_delete
  allow_unauthenticated   = each.value.allow_unauthenticated
  allowed_principals      = each.value.allowed_principals
  service_account         = each.value.service_account
}

