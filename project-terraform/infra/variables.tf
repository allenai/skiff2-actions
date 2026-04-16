variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region for Cloud Run services"
  type        = string
  default     = "us-west1"
}

variable "default_service" {
  description = "Cloud Run service name for the default/root service (e.g., 'ui')"
  type        = string
}

variable "use_classic_load_balancer" {
  type = bool
}

variable "branch_environments" {
  description = "List of active non-prod branch environment names (sanitized)"
  type        = list(string)
  default     = []
}

variable "custom_domain_mappings" {
  description = "Map of custom domain to Cloud Run service name"
  type        = map(string)
  default     = {}
}

variable "backends" {
  description = "Backend NEGs to create. Emitted by the deploy-infra action from skiff2.json. Keys here double as URL map backend suffixes (default-lb-backend-<key>)."
  type = map(object({
    neg_name          = string
    cloud_run_service = optional(string)
    url_mask          = optional(string)
  }))
}
