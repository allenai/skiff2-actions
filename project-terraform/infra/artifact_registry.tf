
resource "google_artifact_registry_repository" "gcr-io" {
  location      = "us"
  repository_id = "gcr.io"
  format        = "DOCKER"

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-minimum-versions"
    action = "KEEP"

    most_recent_versions {
      # Layers seem to be included in this count so we bump it up higher than what would seem reasonable otherwise
      keep_count = 30
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"

    condition {
      older_than = "30d"
    }
  }
}

import {
  to = google_artifact_registry_repository.gcr-io
  id = "us/gcr.io"
}
