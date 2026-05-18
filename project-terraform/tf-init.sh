#!/usr/bin/env bash
#
# Fetches a repo's skiff2.json, generates tfvars, and runs terraform init
# for the project-terraform module. Useful for manual testing.
#
# Runs the same Node entrypoints as the deploy-infra / deploy-services
# composite actions, so the generated tfvars match what CI would produce.
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
    echo "  2. Run the shared deploy-infra and deploy-services Node entrypoints"
    echo "     to generate generated.auto.tfvars.json (same code path as CI)"
    echo "  3. Run terraform init with the correct backend bucket"
    echo "  4. Select the appropriate workspace (services component)"
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
REGION="us-west1"
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

PROD_BRANCH=$(echo "$SKIFF2_JSON" | jq -r '.prodBranch // "main"')
echo "==> Prod branch: $PROD_BRANCH"

# Write the fetched skiff2.json to a temp workspace (the Node entrypoints
# resolve config_file relative to GITHUB_WORKSPACE).
TMPDIR_PATH=$(mktemp -d)
trap 'rm -rf "$TMPDIR_PATH"' EXIT
echo "$SKIFF2_JSON" > "$TMPDIR_PATH/skiff2.json"

# Make sure shared-action deps are installed (the action does `npm ci` first).
if [ ! -d "$SHARED_ACTIONS_DIR/node_modules" ]; then
    echo "==> Installing shared-actions dependencies..."
    (cd "$SHARED_ACTIONS_DIR" && npm ci)
fi

run_infra() {
    local tf_dir="$REPO_ROOT/project-terraform/infra"

    echo ""
    echo "========================================"
    echo "==> Initializing component: infra"
    echo "========================================"

    echo "==> Generating tfvars via deploy-infra/index.ts..."
    (
        cd "$SHARED_ACTIONS_DIR"
        GITHUB_WORKSPACE="$TMPDIR_PATH" \
        TERRAFORM_DIR="$tf_dir" \
        INPUT_CONFIG_FILE="skiff2.json" \
        INPUT_PROJECT_ID="$PROJECT_ID" \
        INPUT_REGION="$REGION" \
        INPUT_USE_CLASSIC_LOAD_BALANCER="false" \
        node ./deploy-infra/index.ts
    )

    echo ""
    echo "==> Generated tfvars for infra:"
    jq . "$tf_dir/generated.auto.tfvars.json"

    echo ""
    echo "==> Cleaning up terraform directory for infra..."
    rm -rf "$tf_dir/.terraform" "$tf_dir/.terraform.lock.hcl"

    echo ""
    echo "==> Running terraform init for infra with backend bucket: ${PROJECT_ID}-tf-state"
    (cd "$tf_dir" && terraform init -backend-config="bucket=${PROJECT_ID}-tf-state")
}

run_services() {
    local tf_dir="$REPO_ROOT/project-terraform/services"

    echo ""
    echo "========================================"
    echo "==> Initializing component: services"
    echo "========================================"

    echo "==> Generating tfvars via deploy-services/index.ts..."
    (
        cd "$SHARED_ACTIONS_DIR"
        GITHUB_WORKSPACE="$TMPDIR_PATH" \
        TERRAFORM_DIR="$tf_dir" \
        INPUT_CONFIG_FILE="skiff2.json" \
        INPUT_PROJECT_ID="$PROJECT_ID" \
        INPUT_REGION="$REGION" \
        INPUT_REPO_NAME="$REPO_NAME" \
        INPUT_ENVIRONMENT="$PROD_BRANCH" \
        INPUT_SERVICES="" \
        INPUT_DEPLOY_TAG="$PROD_BRANCH" \
        node ./deploy-services/index.ts
    )

    echo ""
    echo "==> Generated tfvars for services:"
    jq . "$tf_dir/generated.auto.tfvars.json"

    echo ""
    echo "==> Cleaning up terraform directory for services..."
    rm -rf "$tf_dir/.terraform" "$tf_dir/.terraform.lock.hcl"

    echo ""
    echo "==> Running terraform init for services with backend bucket: ${PROJECT_ID}-tf-state"
    (cd "$tf_dir" && terraform init -backend-config="bucket=${PROJECT_ID}-tf-state")

    # Mirrors deploy-services/action.yml: `sanitizeBranchTag(repo)--sanitizeBranchTag(env)`
    local sanitized_repo
    local sanitized_env
    sanitized_repo=$(echo "$REPO_NAME" | sed 's/[^a-zA-Z0-9._-]/-/g')
    sanitized_env=$(echo "$PROD_BRANCH" | sed 's/[^a-zA-Z0-9._-]/-/g')
    local workspace="${sanitized_repo}--${sanitized_env}"
    echo ""
    echo "==> Selecting workspace: $workspace"
    (cd "$tf_dir" && terraform workspace select -or-create "$workspace")
}

run_infra
run_services

echo ""
echo "==> Done! Both components initialized. Run terraform commands from:"
echo "    cd $REPO_ROOT/project-terraform/infra"
echo "    cd $REPO_ROOT/project-terraform/services"
