import * as core from "@actions/core";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { BuildConfigSchema, type RemoteServiceConfig, type ServiceConfig } from "../shared/skiff2-config.ts";
import { sanitizeBranchTag } from "../shared/utils.ts";

const mapCustomDomainsFromService = (
    serviceConfigs: ServiceConfig[] | RemoteServiceConfig[]
  ): Record<string, string> => {
    const domainMappings: Record<string, string> = {};
    for (const service of serviceConfigs) {
      if (service.deploy === false) continue;
      for (const domain of service.customDomains) {
        domainMappings[domain] = `prod-${service.name}`;
      }
    }
    return domainMappings;
  }

async function main() {
  const configPath = core.getInput("config_file", { required: true });
  const projectId = core.getInput("project_id", { required: true });
  const region = core.getInput("region", { required: true });
  const useClassicLoadBalancer = core.getBooleanInput("use_classic_load_balancer")
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

  // Find the default (root) service
  let defaultServiceName: string | undefined;
  for (const service of config.services) {
    if (service.deploy === false) continue;
    if (service.isRootService || !defaultServiceName) {
      defaultServiceName = service.name;
    }
  }

  if (!defaultServiceName) {
    throw new Error("No default service could be determined");
  }

  // Build custom domain mappings from service configs (prod only)
  const customDomainMappings: Record<string, string> = {
    ...mapCustomDomainsFromService(config.remoteServices || []),
    ...mapCustomDomainsFromService(config.services),
  };

  // Branch environments (non-main, sanitized)
  const branchEnvironments = allEnvironments
    .filter((e) => e !== "main")
    .map(sanitizeBranchTag);

  core.info(`Default service: ${defaultServiceName}`);
  core.info(`Branch environments: ${branchEnvironments.join(", ") || "none"}`);
  core.info(`Custom domains: ${Object.keys(customDomainMappings).join(", ") || "none"}`);

  const tfvars = {
    project_id: projectId,
    region,
    default_service: defaultServiceName,
    branch_environments: branchEnvironments,
    custom_domain_mappings: customDomainMappings,
    use_classic_load_balancer: useClassicLoadBalancer
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
