variable "service_name" {
  description = "The Cloud Run service name (map key)"
  type        = string
}

variable "service_containers" {
  description = "Service configuration objects, including sidecars"
  type = list(object({
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
  }))
}

variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "project_number" {
  description = "The GCP project number"
  type        = string
}

variable "region" {
  description = "The GCP region for Cloud Run services"
  type        = string
}

variable "deployment_environment" {
  description = "The deployment environment (e.g. prod, staging)"
  type        = string
}

variable "image_tag" {
  description = "The image tag to use for container images (e.g. branch name)"
  type        = string
}

variable "allow_unauthenticated" {
  type    = bool
  default = false
}

variable "allowed_principals" {
  description = "GCP IAM members granted roles/iap.httpsResourceAccessor on this service. Ignored when allow_unauthenticated is true."
  type        = list(string)
}

variable "allow_delete" {
  type = bool
}

variable "min_instances" {
  type = number
}

variable "max_instances" {
  type = number
}

variable "service_account" {
  type        = string
  default     = null
  description = "The service account to run this service with. Applies to all containers (sidecars) in the service. Will look something like <ACCOUNT_NAME>@<PROJECT_NAME>.iam.gserviceaccount.com"
}
