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
SHARED_ACTIONS_DIR="$REPO_ROOT/shared-actions"

if [ $# -lt 2 ]; then
    echo "Usage: $0 <org/repo> <project-name>"
    echo ""
    echo "This script will:"
    echo "  1. Fetch skiff2.json from the repo (via gh CLI)"
    echo "  2. Generate generated.auto.tfvars.json via shared-actions TS scripts"
    echo "  3. Run terraform init with the correct backend bucket"
    echo "  4. Select the appropriate workspace (services component only)"
    echo ""
    echo "Prerequisites: gh CLI authenticated, terraform installed, node >= 24"
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

# Write the fetched skiff2.json to a temp dir (simulates GITHUB_WORKSPACE)
TMPDIR_PATH=$(mktemp -d)
echo "$SKIFF2_JSON" > "$TMPDIR_PATH/skiff2.json"

# Install shared-actions dependencies
echo ""
echo "==> Installing shared-actions dependencies..."
cd "$SHARED_ACTIONS_DIR"
npm ci --silent

for COMPONENT in infra services; do
    echo ""
    echo "========================================"
    echo "==> Initializing component: $COMPONENT"
    echo "========================================"

    TF_DIR="$REPO_ROOT/project-terraform/$COMPONENT"

    # Generate tfvars via the same TS scripts used by GitHub Actions
    echo "==> Generating tfvars for $COMPONENT..."

    if [ "$COMPONENT" = "infra" ]; then
        GITHUB_WORKSPACE="$TMPDIR_PATH" \
        TERRAFORM_DIR="$TF_DIR" \
        INPUT_CONFIG_FILE="skiff2.json" \
        INPUT_PROJECT_ID="$PROJECT_ID" \
        INPUT_REGION="us-west1" \
        INPUT_USE_CLASSIC_LOAD_BALANCER="false" \
        node "$SHARED_ACTIONS_DIR/deploy-infra/generate-infra-tfvars.ts"
    else
        GITHUB_WORKSPACE="$TMPDIR_PATH" \
        TERRAFORM_DIR="$TF_DIR" \
        INPUT_CONFIG_FILE="skiff2.json" \
        INPUT_PROJECT_ID="$PROJECT_ID" \
        INPUT_REGION="us-west1" \
        INPUT_REPO_NAME="$REPO_NAME" \
        INPUT_ENVIRONMENT="main" \
        INPUT_SERVICES="" \
        INPUT_DEPLOY_TAG="main" \
        node "$SHARED_ACTIONS_DIR/deploy-services/index.ts"
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
