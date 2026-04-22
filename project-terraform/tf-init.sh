#!/usr/bin/env bash
#
# Fetches a repo's skiff2.json, generates tfvars, and runs terraform init
# for the project-terraform module. Useful for manual testing.
#
# Usage:
#   ./project-terraform/tf-init.sh <org/repo> <project-name>
#
# Examples:
#   ./project-terraform/tf-init.sh allenai/oncall-web oncall-web
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 2 ]; then
    echo "Usage: $0 <org/repo> <project-name> [infra|services]"
    echo ""
    echo "This script will:"
    echo "  1. Fetch skiff2.json from the repo (via gh CLI)"
    echo "  2. Generate generated.auto.tfvars.json"
    echo "  3. Run terraform init with the correct backend bucket"
    echo "  4. Select the appropriate workspace (services component only)"
    echo ""
    echo "Prerequisites: gh CLI authenticated, terraform installed"
    exit 1
fi

FULL_REPO="$1"
REPO_NAME="${FULL_REPO#*/}"
PROJECT_NAME="$2"

echo "==> Repo: $FULL_REPO"
echo "==> Repo name: $REPO_NAME"
echo "==> Project name: $PROJECT_NAME"

PROJECT_ID="ai2-skiff2-$PROJECT_NAME"
echo "==> Project ID: $PROJECT_ID"

# Fetch skiff2.json from the repo
echo "==> Fetching skiff2.json from $FULL_REPO..."
SKIFF2_JSON=$(gh api "repos/$FULL_REPO/contents/skiff2.json" --jq '.content' | base64 -d)

if [ -z "$SKIFF2_JSON" ]; then
    echo "Error: Could not fetch skiff2.json from $FULL_REPO"
    exit 1
fi

echo "==> skiff2.json contents:"
echo "$SKIFF2_JSON" | jq .

# Write the fetched skiff2.json to a temp file
TMPDIR_PATH=$(mktemp -d)
echo "$SKIFF2_JSON" > "$TMPDIR_PATH/skiff2.json"

for COMPONENT in infra services; do
    echo ""
    echo "========================================"
    echo "==> Initializing component: $COMPONENT"
    echo "========================================"

    TF_DIR="$REPO_ROOT/project-terraform/$COMPONENT"

    # Generate tfvars via Node
    echo "==> Generating tfvars for $COMPONENT..."

    cd "$REPO_ROOT/shared-actions"

    if [ "$COMPONENT" = "infra" ]; then
        # Infra: build services for ALL environments
        SERVICES_JSON=$(echo "$SKIFF2_JSON" | jq --arg repo "$REPO_NAME" '
            (.environments // ["main"]) as $environments |
            [
                $environments[] as $branch |
                ($branch | gsub("[^a-zA-Z0-9._-]"; "-")) as $sanitized |
                (if $branch == "main" then "prod" else $sanitized end) as $dep_env |
                .services[] | select(.deploy != false) |
                {
                    key: (if $branch == "main" then .name else ($dep_env + "-" + .name) end),
                    value: {
                        name: .name,
                        container_name: ($repo + "-" + .name),
                        secondary_container_name: (if .secondaryImage then ($repo + "-" + .secondaryImage) else null end),
                        allow_unauthenticated: (.allowUnauthenticated // false),
                        allow_delete: (.allowDelete // false),
                        secret_files: (.secretFiles // {}),
                        custom_domains: (if $branch == "main" then (.customDomains // []) else [] end),
                        image_tag: $sanitized,
                        deployment_environment: $dep_env
                    }
                }
            ] | from_entries
        ')

        DEFAULT_SERVICE=$(echo "$SKIFF2_JSON" | jq -r '
            (.services[] | select(.isRootService == true) | .name) //
            (.services[0] | .name)
        ')

        jq -n \
            --arg project_id "$PROJECT_ID" \
            --arg region "us-west1" \
            --arg default_service "$DEFAULT_SERVICE" \
            --argjson services "$SERVICES_JSON" \
            '{
                project_id: $project_id,
                region: $region,
                default_service: $default_service,
                services: $services
            }' > "$TF_DIR/generated.auto.tfvars.json"
    else
        # Services: generate via Node action
        GITHUB_WORKSPACE="$TMPDIR_PATH" \
        TERRAFORM_DIR="$TF_DIR" \
        INPUT_CONFIG_FILE="skiff2.json" \
        INPUT_PROJECT_ID="$PROJECT_ID" \
        INPUT_REGION="us-west1" \
        INPUT_REPO_NAME="$REPO_NAME" \
        INPUT_SERVICES="" \
        INPUT_DEPLOY_TAG="main" \
        node "./deploy-${COMPONENT}/index.ts" || {
            echo ""
            echo "Note: generate-${COMPONENT}-tfvars.ts uses @actions/core which may fail outside GitHub Actions."
            echo "Falling back to manual tfvars generation..."

            SERVICES_JSON=$(echo "$SKIFF2_JSON" | jq --arg repo "$REPO_NAME" '
                [
                    .services[] | select(.deploy != false) |
                    {
                        key: .name,
                        value: {
                            name: .name,
                            container_name: ($repo + "-" + .name),
                            secondary_container_name: (if .secondaryImage then ($repo + "-" + .secondaryImage) else null end),
                            allow_unauthenticated: (.allowUnauthenticated // false),
                            allow_delete: (.allowDelete // false),
                            secret_files: (.secretFiles // {}),
                            custom_domains: (.customDomains // []),
                            image_tag: "main",
                            deployment_environment: "prod"
                        }
                    }
                ] | from_entries
            ')

            jq -n \
                --arg project_id "$PROJECT_ID" \
                --arg region "us-west1" \
                --argjson services "$SERVICES_JSON" \
                '{
                    project_id: $project_id,
                    region: $region,
                    services: $services
                }' > "$TF_DIR/generated.auto.tfvars.json"
        }
    fi

    echo ""
    echo "==> Generated tfvars for $COMPONENT:"
    cat "$TF_DIR/generated.auto.tfvars.json" | jq .

    # Clean up previous terraform state so init starts fresh
    echo ""
    echo "==> Cleaning up terraform directory for $COMPONENT..."
    rm -rf "$TF_DIR/.terraform" "$TF_DIR/.terraform.lock.hcl"

    # Run terraform init
    echo ""
    echo "==> Running terraform init for $COMPONENT with backend bucket: ${PROJECT_ID}-tf-state"
    cd "$TF_DIR"
    terraform init -backend-config="bucket=${PROJECT_ID}-tf-state"

    # Select workspace for services component
    # TODO: update to use new workspace naming after migration to repoName workspaces is complete
    if [ "$COMPONENT" = "services" ]; then
        echo ""
        echo "==> Selecting default workspace..."
        terraform workspace select default
    fi
done

rm -rf "$TMPDIR_PATH"

echo ""
echo "==> Done! Both components initialized. Run terraform commands from:"
echo "    cd $REPO_ROOT/project-terraform/infra"
echo "    cd $REPO_ROOT/project-terraform/services"
