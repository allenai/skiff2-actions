import * as core from "@actions/core";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { BuildConfigSchema } from "../shared/skiff2-config.ts";
import { mapServices } from "./map-service.ts";

function sanitizeBranchTag(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function generateServicesTFVars() {
  const configPath = core.getInput("config_file", { required: true });
  const projectId = core.getInput("project_id", { required: true });
  const region = core.getInput("region", { required: true });
  const repoName = core.getInput("repo_name", { required: true });
  const terraformDir = process.env.TERRAFORM_DIR;

  if (!terraformDir) {
    throw new Error("TERRAFORM_DIR environment variable is required");
  }

  const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
  const configFile = resolve(workspaceRoot, configPath);

  core.info(`Reading config from: ${configFile}`);

  const configContent = await readFile(configFile, "utf-8");
  const rawConfig = JSON.parse(configContent);
  const config = BuildConfigSchema.parse(rawConfig);

  const environmentInput = core.getInput("environment");
  const allEnvironments = config.environments ?? ["main"];

  if (environmentInput && !allEnvironments.includes(environmentInput)) {
    throw new Error(
      `Environment "${environmentInput}" not found in config. Available: ${allEnvironments.join(", ")}`,
    );
  }

  const servicesToDeploy = core.getInput("services");

  // Build services for ONLY the target environment
  const targetBranch = environmentInput || "main";
  const isMainBranch = targetBranch === "main";
  const deploymentEnv = isMainBranch ? "prod" : sanitizeBranchTag(targetBranch);
  const imageTag = core.getInput("deploy_tag", { required: true });

  core.info(`Building services map for environment "${targetBranch}"`);

  const services = mapServices(config.services, {
    servicesToDeploy,
    repoName,
    imageTag,
    isMainBranch,
    deploymentEnv,
  });

  if (Object.keys(services).length === 0) {
    throw new Error("No deployable services found in config");
  }

  core.info(`Found ${Object.keys(services).length} deployable service(s)`);

  const tfvars = {
    project_id: projectId,
    region,
    services,
    deployment_environment: deploymentEnv,
    image_tag: imageTag,
  };

  const tfvarsPath = resolve(terraformDir, "generated.auto.tfvars.json");
  await writeFile(tfvarsPath, JSON.stringify(tfvars, null, 2));

  core.info(`Generated terraform variables at: ${tfvarsPath}`);
  core.info(JSON.stringify(tfvars, null, 2));

  const workspace = isMainBranch ? "default" : sanitizeBranchTag(targetBranch);
  core.setOutput("workspace", workspace);

  const projectName = projectId.replace(/^ai2-skiff2-/, "");
  core.setOutput("default_url", `https://${projectName}.pandajungle.org`);
}
