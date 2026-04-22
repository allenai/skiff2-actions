#!/bin/bash
set -e

# Migrate terraform state from old workspace naming to new repo-based naming
# Must be run from the terraform directory after `terraform init`
# this can be run multiple times to safely migrate changed workspaces.
#
# Usage: ./migrate-workspace.sh <new_workspace> <environment>
#   or:  ./migrate-workspace.sh <repo_name> <environment> --compute-workspace
#
# Examples:
#   ./migrate-workspace.sh my-repo--main main
#   ./migrate-workspace.sh my-repo main --compute-workspace

sanitize() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//' | cut -c1-63
}

workspace_has_state() {
  local workspace="$1"
  if ! terraform workspace select "$workspace" 2>/dev/null; then
    return 1
  fi
  local state_size
  state_size=$(terraform state pull | wc -c)
  [ "$state_size" -gt 10 ]
}

select_or_create_workspace() {
  local workspace="$1"
  if ! terraform workspace select "$workspace" 2>/dev/null; then
    terraform workspace new "$workspace"
  fi
}

# Parse arguments
if [ $# -lt 2 ]; then
  echo "Usage: $0 <new_workspace> <environment>"
  echo "   or: $0 <repo_name> <environment> --compute-workspace"
  exit 1
fi

ENVIRONMENT="$2"

if [ "$3" = "--compute-workspace" ]; then
  REPO_NAME="${1##*/}"  # Strip org prefix (e.g., allenai/my-repo -> my-repo)
  NEW_WORKSPACE="$(sanitize "$REPO_NAME")--$(sanitize "$ENVIRONMENT")"
  echo "Computed workspace: $NEW_WORKSPACE"
else
  NEW_WORKSPACE="$1"
fi

# Determine old workspace name
if [ "$ENVIRONMENT" = "main" ]; then
  OLD_WORKSPACE="default"
else
  OLD_WORKSPACE=$(sanitize "$ENVIRONMENT")
fi

echo "Migration: '$OLD_WORKSPACE' → '$NEW_WORKSPACE'"

# Check if old workspace exists and has state
if ! workspace_has_state "$OLD_WORKSPACE"; then
  echo "⚠️ No '$OLD_WORKSPACE' workspace or state, skipping migration"
  exit 0
fi

# Perform migration
echo "🔄 Getting state from '$OLD_WORKSPACE'"
select_or_create_workspace "$OLD_WORKSPACE"
OLD_STATE=$(terraform state pull)

echo "🔄 Pushing state to '$NEW_WORKSPACE'"
select_or_create_workspace "$NEW_WORKSPACE"
echo "$OLD_STATE" | terraform state push -

echo "✅ Migration complete"
