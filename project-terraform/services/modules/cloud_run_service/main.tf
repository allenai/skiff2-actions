
# Fetch Secret Manager secrets for this service using the service name as a prefix.
# Filter is a substring match, so "name:my-service-" matches any secret whose name contains that string.
#
# TODO?: change secrets -- they are currently env-service prefixed
data "google_secret_manager_secrets" "app_secrets" {
  for_each = toset([for key, service in var.service_containers : service.name])

  filter = "name:${var.deployment_environment}-${each.value}-"
}

resource "google_cloud_run_v2_service" "service" {
  provider = google-beta
  name     = "${var.deployment_environment}-${var.service_name}"
  location = var.region

  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  launch_stage         = "GA"
  iap_enabled          = true
  invoker_iam_disabled = true
  deletion_protection  = !var.allow_delete

  template {
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    dynamic "containers" {
      for_each = var.service_containers
      content {
        name  = containers.value.name
        image = "gcr.io/${var.project_id}/${containers.value.container_name}:${var.image_tag}"

        dynamic "ports" {
          for_each = containers.value.port != null ? [containers.value.port] : []
          content {

            name           = ports.value.name
            container_port = ports.value.port
          }
        }

        resources {
          limits = {
            cpu    = containers.value.machine.cpu
            memory = containers.value.machine.memory
          }
          cpu_idle = containers.value.machine.cpu_idle
        }

        # Startup probe to handle application startup
        startup_probe {
          initial_delay_seconds = containers.value.startup.initial_delay_seconds
          timeout_seconds       = containers.value.startup.timeout_seconds
          period_seconds        = containers.value.startup.period_seconds
          failure_threshold     = containers.value.startup.failure_threshold

          http_get {
            path = containers.value.startup.path
            port = containers.value.startup.port
          }
        }

        # Liveness probe - using HTTP GET on the root health check endpoint
        liveness_probe {
          initial_delay_seconds = containers.value.liveness.initial_delay_seconds
          timeout_seconds       = containers.value.liveness.timeout_seconds
          period_seconds        = containers.value.liveness.period_seconds
          failure_threshold     = containers.value.liveness.failure_threshold

          http_get {
            path = containers.value.liveness.path
            port = containers.value.liveness.port
          }
        }

        env {
          name  = "SKIFF_ENV"
          value = var.deployment_environment
        }

        # Dynamically inject secrets from Secret Manager.
        # Secrets must be named "<ENV_VAR>-<service-name>".
        # The prefix and hyphens are stripped/converted to produce the env var name.
        dynamic "env" {
          for_each = data.google_secret_manager_secrets.app_secrets[containers.value.name].secrets

          content {
            name = trimprefix(env.value.secret_id, "${var.deployment_environment}-${containers.value.name}-")

            value_source {
              secret_key_ref {
                secret  = env.value.secret_id
                version = "latest"
              }
            }
          }
        }

        # Mount secret files as volumes
        dynamic "volume_mounts" {
          for_each = containers.value.secret_files

          content {
            name       = lower(replace(volume_mounts.key, "_", "-"))
            mount_path = dirname(volume_mounts.value)
          }
        }
      }
    }

    # Secret file volumes
    dynamic "volumes" {
      for_each = flatten([for key, value in var.service_containers : value.secret_files if value.secret_files != null && length(value.secret_files) > 0])

      content {
        name = lower(replace(volumes.key, "_", "-"))

        secret {
          secret = "${var.deployment_environment}-${containers.value.name}-${replace(volumes.key, "_", "-")}"

          items {
            version = "latest"
            path    = basename(volumes.value)
          }
        }
      }
    }

    dynamic "vpc_access" {
      for_each = [for key, value in var.service_containers : value.vpc if value.vpc != null]
      content {
        network_interfaces {
          network    = vpc_access.value.network
          subnetwork = vpc_access.value.subnetwork
        }
        egress = vpc_access.value.egress
      }
    }


    timeout                          = "300s"
    max_instance_request_concurrency = 80
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# Grant the IAP service agent roles/run.invoker so it can invoke the service
# on behalf of authenticated users
resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
  name     = google_cloud_run_v2_service.service.name
  location = google_cloud_run_v2_service.service.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:service-${var.project_number}@gcp-sa-iap.iam.gserviceaccount.com"
}

data "google_iam_policy" "admin" {
  binding {
    role = "roles/iap.httpsResourceAccessor"
    members = [
      var.allow_unauthenticated ? "allUsers" : "domain:allenai.org"
    ]
  }
}

resource "google_iap_web_cloud_run_service_iam_policy" "policy" {
  project                = google_cloud_run_v2_service.service.project
  location               = google_cloud_run_v2_service.service.location
  cloud_run_service_name = google_cloud_run_v2_service.service.name
  policy_data            = data.google_iam_policy.admin.policy_data
}
