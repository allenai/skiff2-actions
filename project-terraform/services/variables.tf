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
    name                     = string
    container_name           = string
    secondary_container_name = optional(string)
    allow_unauthenticated    = bool
    allow_delete             = bool
    secret_files             = map(string)
    custom_domains           = list(string)
    image_tag                = string
    deployment_environment   = string
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
  }))
}
