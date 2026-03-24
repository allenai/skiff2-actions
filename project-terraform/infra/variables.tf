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
  description = "Map of Cloud Run services (all environments). Used for routing configuration."
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
  }))
}

variable "default_service" {
  description = "Key from the services map to use as the default load balancer backend"
  type        = string
}
