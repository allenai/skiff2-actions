
# Fetch Secret Manager secrets for this service using the service name as a prefix.
# Filter is a substring match, so "name:my-service-" matches any secret whose name contains that string.
# Two naming conventions are supported:
#   - hyphen form (legacy): "global-<container>-<KEY>" / "<env>-<container>-<KEY>"
#   - double-underscore form: "global__<container>__<KEY>" / "<env>__<container>__<KEY>"
# The double-underscore form avoids prefix collisions when one service name is a prefix of another
# (e.g. "api" vs "api-two"), since "_" is not a valid character in Cloud Run service names.
data "google_secret_manager_secrets" "app_secrets" {
  for_each = toset([for key, container in var.service_containers : container.name])

  filter = "name:global-${each.value}- OR name:${var.deployment_environment}-${each.value}- OR name:global__${each.value}__ OR name:${var.deployment_environment}__${each.value}__"
}

data "google_compute_default_service_account" "default_service_account" {
}

locals {
  # Build map of { container: { secret_key: secret_id } }
  # Merge order (lowest to highest precedence):
  #   1. global-<container>-<KEY>           (legacy hyphen form)
  #   2. <env>-<container>-<KEY>            (legacy hyphen form)
  #   3. global__<container>__<KEY>         (double-underscore form)
  #   4. <env>__<container>__<KEY>          (double-underscore form)
  # Double-underscore entries win over hyphen entries with the same key, allowing per-secret migration.
  secret_file_map = {
    for container_name, secrets_data in data.google_secret_manager_secrets.app_secrets :
    container_name => merge(
      {
        for secret in secrets_data.secrets :
        trimprefix(secret.secret_id, "global-${container_name}-") => secret.secret_id
        if startswith(secret.secret_id, "global-${container_name}-")
      },
      {
        for secret in secrets_data.secrets :
        trimprefix(secret.secret_id, "${var.deployment_environment}-${container_name}-") => secret.secret_id
        if startswith(secret.secret_id, "${var.deployment_environment}-${container_name}-")
      },
      {
        for secret in secrets_data.secrets :
        trimprefix(secret.secret_id, "global__${container_name}__") => secret.secret_id
        if startswith(secret.secret_id, "global__${container_name}__")
      },
      {
        for secret in secrets_data.secrets :
        trimprefix(secret.secret_id, "${var.deployment_environment}__${container_name}__") => secret.secret_id
        if startswith(secret.secret_id, "${var.deployment_environment}__${container_name}__")
      }
    )
  }

  # The Cloud Run TF module doesn't reset the service account if it's set to null. Explicitly setting the default compute service account handles that 
  service_account_email = var.service_account != null ? var.service_account : data.google_compute_default_service_account.default_service_account.email
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
    service_account = local.service_account_email

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
        dynamic "startup_probe" {
          for_each = containers.value.startup != null ? [containers.value.startup] : []
          content {
            initial_delay_seconds = containers.value.startup.initial_delay_seconds
            timeout_seconds       = containers.value.startup.timeout_seconds
            period_seconds        = containers.value.startup.period_seconds
            failure_threshold     = containers.value.startup.failure_threshold

            http_get {
              path = containers.value.startup.path
              port = containers.value.startup.port
            }
          }
        }

        # Liveness probe - using HTTP GET on the root health check endpoint
        dynamic "liveness_probe" {
          for_each = containers.value.liveness != null ? [containers.value.liveness] : []
          content {
            initial_delay_seconds = containers.value.liveness.initial_delay_seconds
            timeout_seconds       = containers.value.liveness.timeout_seconds
            period_seconds        = containers.value.liveness.period_seconds
            failure_threshold     = containers.value.liveness.failure_threshold

            http_get {
              path = containers.value.liveness.path
              port = containers.value.liveness.port
            }
          }
        }

        env {
          name  = "SKIFF_ENV"
          value = var.deployment_environment
        }

        # Dynamically inject secrets from Secret Manager.
        # Supported naming conventions (precedence: lowest -> highest):
        #   global-<container>-<KEY>            (legacy hyphen form)
        #   <env>-<container>-<KEY>             (legacy hyphen form)
        #   global__<container>__<KEY>          (double-underscore form)
        #   <env>__<container>__<KEY>           (double-underscore form)
        # Higher-precedence entries override lower-precedence ones with the same KEY.
        dynamic "env" {
          for_each = merge(tomap({
            for secret in data.google_secret_manager_secrets.app_secrets[containers.value.name].secrets :
            trimprefix(secret.secret_id, "global-${containers.value.name}-") => secret.secret_id
            if startswith(secret.secret_id, "global-${containers.value.name}-")
            }),
            tomap({
              for secret in data.google_secret_manager_secrets.app_secrets[containers.value.name].secrets :
              trimprefix(secret.secret_id, "${var.deployment_environment}-${containers.value.name}-") => secret.secret_id
              if startswith(secret.secret_id, "${var.deployment_environment}-${containers.value.name}-")
            }),
            tomap({
              for secret in data.google_secret_manager_secrets.app_secrets[containers.value.name].secrets :
              trimprefix(secret.secret_id, "global__${containers.value.name}__") => secret.secret_id
              if startswith(secret.secret_id, "global__${containers.value.name}__")
            }),
            tomap({
              for secret in data.google_secret_manager_secrets.app_secrets[containers.value.name].secrets :
              trimprefix(secret.secret_id, "${var.deployment_environment}__${containers.value.name}__") => secret.secret_id
              if startswith(secret.secret_id, "${var.deployment_environment}__${containers.value.name}__")
          }))

          content {
            name = env.key

            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }

        # Mount secret files as volumes
        dynamic "volume_mounts" {
          for_each = containers.value.secret_files

          content {
            name       = lower(replace("${containers.value.name}-${volume_mounts.key}", "_", "-"))
            mount_path = dirname(volume_mounts.value)
          }
        }
      }
    }

    # Secret file volumes
    dynamic "volumes" {
      for_each = merge([
        for container in var.service_containers : {
          for key, path in try(container.secret_files, {}) :
          "${container.name}-${key}" => {
            container = container.name
            key       = key
            path      = path
          }
        }
      ]...)

      content {
        name = lower(replace("${volumes.value.container}-${volumes.value.key}", "_", "-"))

        secret {
          secret = local.secret_file_map[volumes.value.container][volumes.value.key]

          items {
            version = "latest"
            path    = basename(volumes.value.path)
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
    role    = "roles/iap.httpsResourceAccessor"
    members = var.allow_unauthenticated ? ["allUsers"] : var.allowed_principals
  }
}

resource "google_iap_web_cloud_run_service_iam_policy" "policy" {
  project                = google_cloud_run_v2_service.service.project
  location               = google_cloud_run_v2_service.service.location
  cloud_run_service_name = google_cloud_run_v2_service.service.name
  policy_data            = data.google_iam_policy.admin.policy_data
}
