import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { sanitizeBranchTag } from "../shared/utils.ts";

interface MigrationResult {
  migrated: boolean;
  oldWorkspace: string;
  newWorkspace: string;
}

let terraformCwd: string | undefined;

async function terraform(...args: string[]): Promise<{ exitCode: number; stdout: string }> {
  let stdout = "";
  const exitCode = await exec.exec("terraform", args, {
    cwd: terraformCwd,
    silent: true,
    ignoreReturnCode: true,
    listeners: {
      stdout: (data) => { stdout += data.toString(); },
    },
  });
  return { exitCode, stdout };
}

async function workspaceHasState(workspace: string): Promise<boolean> {
  const selectResult = await terraform("workspace", "select", workspace);
  if (selectResult.exitCode !== 0) {
    return false;
  }

  const pullResult = await terraform("state", "pull");
  return pullResult.stdout.length > 10;
}

async function selectOrCreateWorkspace(workspace: string): Promise<void> {
  const selectResult = await terraform("workspace", "select", workspace);
  if (selectResult.exitCode !== 0) {
    await terraform("workspace", "new", workspace);
  }
}

export async function migrateWorkspace(
  newWorkspace: string,
  environment: string
): Promise<MigrationResult> {
  const oldWorkspace = environment === "main"
    ? "default"
    : sanitizeBranchTag(environment);

  core.info(`Migration check: '${oldWorkspace}' → '${newWorkspace}'`);

  // Check if new workspace already has state
  if (await workspaceHasState(newWorkspace)) {
    core.info(`✅ Workspace '${newWorkspace}' already has state, skipping migration`);
    return { migrated: false, oldWorkspace, newWorkspace };
  }

  // Check if old workspace exists and has state
  const oldSelectResult = await terraform("workspace", "select", oldWorkspace);
  if (oldSelectResult.exitCode !== 0) {
    core.info(`⚠️ No '${oldWorkspace}' workspace, creating '${newWorkspace}'`);
    await selectOrCreateWorkspace(newWorkspace);
    return { migrated: false, oldWorkspace, newWorkspace };
  }

  const oldState = await terraform("state", "pull");
  if (oldState.stdout.length < 10) {
    core.info(`⚠️ No state in '${oldWorkspace}', creating '${newWorkspace}'`);
    await selectOrCreateWorkspace(newWorkspace);
    return { migrated: false, oldWorkspace, newWorkspace };
  }

  // Perform migration
  core.info(`🔄 Migrating state from '${oldWorkspace}' to '${newWorkspace}'`);
  await selectOrCreateWorkspace(newWorkspace);

  const pushResult = await exec.exec("terraform", ["state", "push", "-"], {
    input: Buffer.from(oldState.stdout),
    ignoreReturnCode: true,
  });

  if (pushResult !== 0) {
    throw new Error(`Failed to push state to workspace '${newWorkspace}'`);
  }

  core.info("✅ Migration complete");
  return { migrated: true, oldWorkspace, newWorkspace };
}

export async function main() {
  const environment = process.env.INPUT_ENVIRONMENT;
  const repoName = process.env.INPUT_REPO_NAME;
  let newWorkspace = process.env.INPUT_NEW_WORKSPACE;
  terraformCwd = process.env.TERRAFORM_DIR;

  if (!environment) {
    core.setFailed("Missing required input: INPUT_ENVIRONMENT");
    return;
  }

  if (!terraformCwd) {
    core.setFailed("Missing required input: TERRAFORM_DIR");
    return;
  }

  // Compute workspace from repo_name + environment if not provided directly
  if (!newWorkspace) {
    if (!repoName) {
      core.setFailed("Missing required input: INPUT_NEW_WORKSPACE or INPUT_REPO_NAME");
      return;
    }
    newWorkspace = `${sanitizeBranchTag(repoName)}--${sanitizeBranchTag(environment)}`;
  }

  try {
    const result = await migrateWorkspace(newWorkspace, environment);
    core.setOutput("migrated", result.migrated.toString());
    core.setOutput("old_workspace", result.oldWorkspace);
    core.setOutput("new_workspace", result.newWorkspace);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("Unknown error occurred");
    }
  }
}
