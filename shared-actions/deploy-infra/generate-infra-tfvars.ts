import * as core from "@actions/core";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { BuildConfigSchema } from "../shared/skiff2-config.ts";
import { sanitizeBranchTag } from "../shared/utils.ts";

// Domain families served by the shared LB. Must stay in sync with
// local.domain_families in project-terraform/infra/main.tf.
const DOMAIN_FAMILIES: Record<string, string> = {
  allenai: "allen.ai",
  apps: "apps.allenai.org",
  pandajungle: "pandajungle.org",
};

type Backend = {
  neg_name: string;
  cloud_run_service?: string;
  url_mask?: string;
};

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
  const customDomainMappings: Record<string, string> = {};
  for (const service of config.services) {
    if (service.deploy === false) continue;
    for (const domain of service.customDomains) {
      customDomainMappings[domain] = `prod-${service.name}`;
    }
  }

  // Branch environments (non-main, sanitized)
  const branchEnvironments = allEnvironments
    .filter((e) => e !== "main")
    .map(sanitizeBranchTag);

  core.info(`Default service: ${defaultServiceName}`);
  core.info(`Branch environments: ${branchEnvironments.join(", ") || "none"}`);
  core.info(`Custom domains: ${Object.keys(customDomainMappings).join(", ") || "none"}`);

  const projectName = projectId.replace(/^ai2-skiff2-/, "");

  // Build the full NEG/backend set. Keys here are also used as the URL map's
  // backend service suffixes (default-lb-backend-<key>) so they must match
  // what main.tf's url_map rules expect.
  const backends: Record<string, Backend> = {};

  // URL-mask NEGs — one per domain family. Route <service>.<base-domain> to
  // the matching Cloud Run service by name.
  for (const [key, domain] of Object.entries(DOMAIN_FAMILIES)) {
    backends[`url-mask-${key}`] = {
      neg_name: `${projectName}-${key}-neg`,
      url_mask: `<service>.${projectName}.${domain}`,
    };
  }

  // Bare-domain routing -> prod default service.
  backends["default"] = {
    neg_name: `${projectName}-default-${defaultServiceName}-neg`,
    cloud_run_service: `prod-${defaultServiceName}`,
  };

  // Branch bare-domain routing -> branch default service.
  for (const branch of branchEnvironments) {
    backends[`branch-${branch}`] = {
      neg_name: `${projectName}-${branch}-default-${defaultServiceName}-neg`,
      cloud_run_service: `${branch}-${defaultServiceName}`,
    };
  }

  // Custom domain routing -> explicit Cloud Run service.
  for (const [domain, service] of Object.entries(customDomainMappings)) {
    const slug = domain.replace(/\./g, "-");
    backends[`custom-${slug}`] = {
      neg_name: `${projectName}-custom-${slug}-neg`,
      cloud_run_service: service,
    };
  }

  const tfvars = {
    project_id: projectId,
    region,
    default_service: defaultServiceName,
    branch_environments: branchEnvironments,
    custom_domain_mappings: customDomainMappings,
    use_classic_load_balancer: useClassicLoadBalancer,
    backends,
  };

  const tfvarsPath = resolve(terraformDir, "generated.auto.tfvars.json");
  await writeFile(tfvarsPath, JSON.stringify(tfvars, null, 2));

  core.info(`Generated terraform variables at: ${tfvarsPath}`);
  core.info(JSON.stringify(tfvars, null, 2));

  // Emit moved blocks for the NEG resource collapse. This is a one-time
  // migration from four separate NEG resources (url_mask / default_service /
  // branch_default / custom_domain) to a single `default` resource keyed by
  // the backend map. Safe to leave in place once all projects have migrated;
  // moved blocks with no matching source state become no-ops.
  const moves: string[] = [];
  for (const key of Object.keys(DOMAIN_FAMILIES)) {
    moves.push(
      `moved {
  from = google_compute_region_network_endpoint_group.url_mask["${key}"]
  to   = google_compute_region_network_endpoint_group.default["url-mask-${key}"]
}`,
    );
  }
  moves.push(
    `moved {
  from = google_compute_region_network_endpoint_group.default_service
  to   = google_compute_region_network_endpoint_group.default["default"]
}`,
  );
  for (const branch of branchEnvironments) {
    moves.push(
      `moved {
  from = google_compute_region_network_endpoint_group.branch_default["${branch}"]
  to   = google_compute_region_network_endpoint_group.default["branch-${branch}"]
}`,
    );
  }
  for (const domain of Object.keys(customDomainMappings)) {
    const slug = domain.replace(/\./g, "-");
    moves.push(
      `moved {
  from = google_compute_region_network_endpoint_group.custom_domain["${domain}"]
  to   = google_compute_region_network_endpoint_group.default["custom-${slug}"]
}`,
    );
  }
  const movesContent = `# Auto-generated by deploy-infra. DO NOT EDIT.
# One-time state migration for the NEG resource collapse. Regenerated on every
# run; delete generation of this file once all projects have migrated.

${moves.join("\n\n")}
`;
  const movesPath = resolve(terraformDir, "generated-moves.tf");
  await writeFile(movesPath, movesContent);
  core.info(`Generated moved blocks at: ${movesPath}`);

  core.setOutput("default_url", `https://${projectName}.pandajungle.org`);
}

main().catch((error) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else {
    core.setFailed("Unknown error occurred");
  }
});
