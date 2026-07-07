
resource "google_artifact_registry_repository" "gcr-io" {
  location      = "us"
  repository_id = "gcr.io"
  format        = "DOCKER"

  cleanup_policy_dry_run = true
  cleanup_policies {
    id     = "keep-minimum-versions"
    action = "KEEP"

    most_recent_versions {
      keep_count = 5
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
