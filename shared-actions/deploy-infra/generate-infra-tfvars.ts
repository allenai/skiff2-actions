import * as core from "@actions/core";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { BuildConfigSchema } from "../shared/skiff2-config.ts";
import { sanitizeBranchTag } from "../shared/utils.ts";

interface ServiceEntry {
  name: string;
  container_name: string;
  secondary_container_name?: string;
  allow_unauthenticated: boolean;
  allow_delete: boolean;
  secret_files: Record<string, string>;
  custom_domains: string[];
  image_tag: string;
  deployment_environment: string;
}

async function main() {
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

  const allEnvironments = config.environments ?? ["main"];

  // Infra needs ALL environments for routing configuration
  const services: Record<string, ServiceEntry> = {};
  let defaultServiceName: string | undefined;

  for (const branch of allEnvironments) {
    const isMainBranch = branch === "main";
    const deploymentEnv = isMainBranch ? "prod" : sanitizeBranchTag(branch);
    const imageTag = sanitizeBranchTag(branch);

    for (const service of config.services) {
      if (service.deploy === false) continue;

      const serviceKey = isMainBranch
        ? service.name
        : `${deploymentEnv}-${service.name}`;

      services[serviceKey] = {
        name: service.name,
        container_name: `${repoName}-${service.name}`,
        allow_unauthenticated: service.allowUnauthenticated,
        allow_delete: service.allowDelete,
        secret_files: service.secretFiles,
        custom_domains: isMainBranch ? service.customDomains : [],
        image_tag: imageTag,
        deployment_environment: deploymentEnv,
      };

      if (service.secondaryImage) {
        services[serviceKey].secondary_container_name =
          `${repoName}-${service.secondaryImage}`;
      }

      if (isMainBranch && (service.isRootService || !defaultServiceName)) {
        defaultServiceName = serviceKey;
      }
    }
  }

  if (Object.keys(services).length === 0) {
    throw new Error("No deployable services found in config");
  }

  if (!defaultServiceName) {
    throw new Error("No default service could be determined");
  }

  core.info(
    `Found ${Object.keys(services).length} service(s) across all environments, default: ${defaultServiceName}`,
  );

  const tfvars = {
    project_id: projectId,
    region,
    default_service: defaultServiceName,
    services,
  };

  const tfvarsPath = resolve(terraformDir, "generated.auto.tfvars.json");
  await writeFile(tfvarsPath, JSON.stringify(tfvars, null, 2));

  core.info(`Generated terraform variables at: ${tfvarsPath}`);
  core.info(JSON.stringify(tfvars, null, 2));

  const projectName = projectId.replace(/^ai2-skiff2-/, "");
  core.setOutput("default_url", `https://${projectName}.pandajungle.org`);
}

main().catch((error) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else {
    core.setFailed("Unknown error occurred");
  }
});
