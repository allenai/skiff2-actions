variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region for Cloud Run services"
  type        = string
  default     = "us-west1"
}

variable "services" {
  description = "Map of Cloud Run services to deploy (single environment only)."
  type = map(object({
    containers = list(object({
      name           = string
      container_name = string
      secret_files   = map(string)

      port = optional(object({
        name = string
        port = number
      }))

      vpc = optional(object({
        network    = string
        subnetwork = string
        egress     = string
      }))

      machine = object({
        memory   = string
        cpu      = string
        cpu_idle = bool
      })

      startup = optional(object({
        initial_delay_seconds = optional(number)
        timeout_seconds       = optional(number)
        period_seconds        = optional(number)
        failure_threshold     = optional(number)

        path = optional(string, "/")
        port = optional(number, 8080)
      }))

      liveness = optional(object({
        initial_delay_seconds = optional(number)
        timeout_seconds       = optional(number)
        period_seconds        = optional(number)
        failure_threshold     = optional(number)

        path = optional(string, "/")
        port = optional(number, 8080)
      }))

      depends_on = list(string)
    }))

    name                  = string
    min_instances         = number
    max_instances         = number
    allow_delete          = bool
    allow_unauthenticated = bool
    allowed_principals    = list(string)
    service_account       = optional(string)
  }))
}

variable "deployment_environment" {
  type = string
}

variable "image_tag" {
  type = string
}

