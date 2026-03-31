variable "service_name" {
  description = "The Cloud Run service name (map key)"
  type        = string
}

variable "service" {
  description = "Service configuration object"
  type = object({
    name                     = string
    container_name           = string
    secondary_container_name = optional(string)
    allow_unauthenticated    = bool
    allow_delete             = bool
    secret_files             = map(string)
    vpc = optional(object({
      network    = string
      subnetwork = string
      egress     = string
    }))
    machine = object({
      min_instances = number
      max_instances = number
      memory        = string
      cpu           = string
      cpu_idle      = bool
    })

    startup = optional(object({
      initial_delay_seconds = optional(number, 10)
      timeout_seconds       = optional(number, 3)
      period_seconds        = optional(3)
      failure_threshold     = optional(number, 5)

      path = optional(string, "/")
      port = optional(number, 8080)
    }), {})

    liveness = optional(object({
      initial_delay_seconds = optional(number, 10)
      timeout_seconds       = optional(number, 5)
      period_seconds        = optional(number, 3)
      failure_threshold     = optional(number, 3)

      path = optional(string, "/")
      port = optional(number, 8080)
    }), {})
  })
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
