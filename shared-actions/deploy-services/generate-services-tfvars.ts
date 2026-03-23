import * as core from "@actions/core";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { BuildConfigSchema } from "../shared/skiff2-config.ts";

function sanitizeBranchTag(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]/g, "-");
}

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
  machine: {
    min_instances: number;
    max_instances: number;
    memory: string;
    cpu: string;
    cpu_idle: boolean;
  };
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

  const environmentInput = core.getInput("environment");
  const allEnvironments = config.environments ?? ["main"];

  if (environmentInput && !allEnvironments.includes(environmentInput)) {
    throw new Error(
      `Environment "${environmentInput}" not found in config. Available: ${allEnvironments.join(", ")}`,
    );
  }

  const servicesInput = core.getInput("services");
  const serviceFilter =
    servicesInput
      ? servicesInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;

  // Validate filtered service names exist in the config
  if (serviceFilter) {
    const configServiceNames = config.services
      .filter((s) => s.deploy !== false)
      .map((s) => s.name);
    const unknownServices = serviceFilter.filter(
      (name) => !configServiceNames.includes(name),
    );
    if (unknownServices.length > 0) {
      throw new Error(
        `Unknown services specified: ${unknownServices.join(", ")}`,
      );
    }
  }

  // Build services for ONLY the target environment
  const targetBranch = environmentInput || "main";
  const isMainBranch = targetBranch === "main";
  const deploymentEnv = isMainBranch ? "prod" : sanitizeBranchTag(targetBranch);
  const imageTag = sanitizeBranchTag(targetBranch);

  core.info(
    `Building services map for environment "${targetBranch}"`,
  );

  const services: Record<string, ServiceEntry> = {};

  for (const service of config.services) {
    if (service.deploy === false) continue;
    if (serviceFilter && !serviceFilter.includes(service.name)) continue;

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
      machine: {
          min_instances: service.machine.minInstances,
          max_instances: service.machine.maxInstances,
          memory: service.machine.memory,
          cpu: String(service.machine.cpu),
          cpu_idle: service.machine.cpuIdle,
        },
    };

    if (service.secondaryImage) {
      services[serviceKey].secondary_container_name =
        `${repoName}-${service.secondaryImage}`;
    }
  }

  if (Object.keys(services).length === 0) {
    throw new Error("No deployable services found in config");
  }

  core.info(
    `Found ${Object.keys(services).length} deployable service(s)`,
  );

  const tfvars = {
    project_id: projectId,
    region,
    services,
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

main().catch((error) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else {
    core.setFailed("Unknown error occurred");
  }
});
