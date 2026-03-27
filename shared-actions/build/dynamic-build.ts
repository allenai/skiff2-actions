import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { readFile } from "fs/promises";
import { dirname, resolve } from "path";
import {
  BuildConfigSchema,
  type ServiceConfig,
  type BuildConfig,
} from "../shared/skiff2-config.ts";
import {
  resolveSecretEnv,
  resolveSecretFile,
  resolveSecretString,
} from "./secrets.ts";

export interface BuildContext {
  registry: string;
  projectId: string;
  repoName: string;
  commitSha: string;
  branchName: string;
  buildArgs: string[] | null;
  secrets: string[] | null;
  secretEnvs: string[] | null;
  secretFiles: string[] | null;
  shouldPush: boolean;
}

interface BuildState {
  builtServices: Set<string>;
  buildingServices: Set<string>;
  builtImages: Record<string, string[]>;
  buildError: Error | null;
}

function createBuildState(): BuildState {
  return {
    builtServices: new Set<string>(),
    buildingServices: new Set<string>(),
    builtImages: {},
    buildError: null,
  };
}

function buildImageTags(
  service: ServiceConfig,
  context: BuildContext,
): string[] {
  const serviceName = `${context.repoName}-${service.name}`;
  const branchTag = context.branchName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const tags = [
    `${context.registry}/${context.projectId}/${serviceName}:${context.commitSha}`,
    `${context.registry}/${context.projectId}/${serviceName}:${branchTag}`,
  ];
  if (context.branchName === "main") {
    tags.push(`${context.registry}/${context.projectId}/${serviceName}:latest`);
  }
  return tags;
}

export function buildDockerArgs(
  service: ServiceConfig,
  context: BuildContext,
  configDir: string,
  tags: string[],
): string[] {
  const serviceName = `${context.repoName}-${service.name}`;
  const buildArgs = [
    "buildx",
    "build",
    "--cache-from",
    `type=registry,ref=${context.registry}/${context.projectId}/${serviceName}:latest`,
    "--cache-to",
    "type=inline",
    "--build-arg",
    "BUILDKIT_INLINE_CACHE=1",
  ];

  if (context.shouldPush) {
    buildArgs.push("--push");
  }

  if (service.extraBuildArgs) {
    // Define environment variables to replace
    const envReplacements: Record<string, string> = {
      PROJECT_ID: context.projectId,
      REPO_NAME: context.repoName,
      COMMIT_SHA: context.commitSha,
    };

    service.extraBuildArgs.forEach((arg) => {
      let processedArg = arg;
      // Replace each environment variable
      for (const [name, value] of Object.entries(envReplacements)) {
        processedArg = processedArg.replace(
          new RegExp(`\\$\\{${name}\\}`, "g"),
          value,
        );
      }
      buildArgs.push(processedArg);
    });
  }

  if (context.buildArgs) {
    const buildArgValues = context.buildArgs.flatMap((buildArg) => [
      "--build-arg",
      buildArg,
    ]);
    buildArgs.push(...buildArgValues);
  }

  if (context.secrets) {
    const secrets = context.secrets.flatMap((secret) => [
      "--secret",
      resolveSecretString(secret),
    ]);
    buildArgs.push(...secrets);
  }

  if (context.secretEnvs) {
    const secretEnvs = context.secretEnvs.flatMap((secretEnv) => [
      "--secret",
      resolveSecretEnv(secretEnv),
    ]);
    buildArgs.push(...secretEnvs);
  }

  if (context.secretFiles) {
    const secretFiles = context.secretFiles.flatMap((secretFile) => [
      "--secret",
      resolveSecretFile(secretFile),
    ]);
    buildArgs.push(...secretFiles);
  }

  tags.forEach((tag) => {
    buildArgs.push("--tag", tag);
  });

  const servicePath = resolve(configDir, service.cwd);

  if (service.dockerFile) {
    buildArgs.push("--file", resolve(servicePath, service.dockerFile));
  }

  // Add context (must be last)
  buildArgs.push(servicePath);

  return buildArgs;
}

async function waitForDependencies(
  dependencies: string[],
  state: BuildState,
): Promise<void> {
  const checkInterval = 100; // ms
  const maxWaitTime = 600000; // 10 minutes
  const startTime = Date.now();

  while (true) {
    // Check if another build has failed
    if (state.buildError) {
      throw new Error(
        `Build cancelled due to failure in another service: ${state.buildError.message}`,
      );
    }

    const allBuilt = dependencies.every((dep) => state.builtServices.has(dep));
    if (allBuilt) {
      return;
    }

    if (Date.now() - startTime > maxWaitTime) {
      throw new Error(
        `Timeout waiting for dependencies: ${dependencies.join(", ")}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }
}

async function buildService(
  service: ServiceConfig,
  context: BuildContext,
  configDir: string,
  state: BuildState,
): Promise<void> {
  const serviceName = `${context.repoName}-${service.name}`;

  // Check if already building or built
  if (state.buildingServices.has(service.name)) {
    return;
  }

  state.buildingServices.add(service.name);

  core.info(`\n🔨 Building ${service.name} (${serviceName})`);

  const tags = buildImageTags(service, context);
  const buildArgs = buildDockerArgs(service, context, configDir, tags);

  const exitCode = await exec.exec("docker", buildArgs);

  if (exitCode !== 0) {
    const error = new Error(`Failed to build ${service.name}`);
    state.buildError = error;
    throw error;
  }

  state.builtServices.add(service.name);
  state.builtImages[service.name] = tags;

  core.info(`✅ Built ${service.name}`);
}

async function buildServiceWithDependencies(
  service: ServiceConfig,
  context: BuildContext,
  configDir: string,
  state: BuildState,
): Promise<void> {
  try {
    if (service.dependsOn && service.dependsOn.length > 0) {
      core.info(
        `Service ${service.name} waiting for dependencies: ${service.dependsOn.join(", ")}`,
      );
      await waitForDependencies(service.dependsOn, state);
    }

    await buildService(service, context, configDir, state);
  } catch (error) {
    // Set error state if not already set
    if (!state.buildError && error instanceof Error) {
      state.buildError = error;
    }
    throw error;
  }
}

function outputBuildResults(state: BuildState): void {
  core.info("\n✅ All images built successfully!");
  for (const [serviceName, tags] of Object.entries(state.builtImages)) {
    core.info(`\n${serviceName}:`);
    tags.forEach((tag) => core.info(`  ${tag}`));
  }

  core.setOutput("built-images", JSON.stringify(state.builtImages));
}

async function buildAll(
  config: BuildConfig,
  context: BuildContext,
  configDir: string,
  serviceFilter: string[] | null,
): Promise<void> {
  const state = createBuildState();

  let services = config.services;
  if (serviceFilter !== null) {
    const unknownServices = serviceFilter.filter(
      (name) => !config.services.some((s) => s.name === name),
    );
    if (unknownServices.length > 0) {
      throw new Error(
        `Unknown services specified: ${unknownServices.join(", ")}`,
      );
    }
    services = config.services.filter((s) => serviceFilter.includes(s.name));
  }

  core.info(`Building ${services.length} services`);

  // Build services, respecting dependencies
  const buildPromises = services.map((service) =>
    buildServiceWithDependencies(service, context, configDir, state),
  );

  await Promise.all(buildPromises);

  // Output results
  outputBuildResults(state);
}

function splitList(input: string, ignoreCommas = false) {
  const splitRegex = ignoreCommas ? "\n" : /,|\n/;
  return input
    .split(splitRegex)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getInputList(
  inputName: string,
  options: core.InputOptions & { ignoreComma: boolean } = {
    ignoreComma: false,
  },
) {
  const { ignoreComma: ignoreCommas, ...restOptions } = options;
  const inputValue = core.getInput(inputName, restOptions);

  if (!inputValue) {
    return null;
  }

  return splitList(inputValue, ignoreCommas);
}

interface ParsedInputs {
  localConfigPath: string;
  registry: string;
  projectId: string;
  repoName: string;
  commitSha: string;
  branchName: string;
  serviceFilter: string[] | null;
  buildArgs: string[] | null;
  secrets: string[] | null;
  secretEnvs: string[] | null;
  secretFiles: string[] | null;
  shouldPush: boolean;
}

export function getInputs(): ParsedInputs {
  const localConfigPath = core.getInput("config_file", { required: true });
  const registry = core.getInput("registry", { required: true });
  const projectId = core.getInput("project_id", { required: true });
  const repoName = core.getInput("repo_name", { required: true });
  const commitSha = core.getInput("commit_sha", { required: true });
  const branchName = core.getInput("branch_name", { required: true });
  const serviceFilter = getInputList("services");
  const buildArgs = getInputList("build_args", { ignoreComma: true });
  const secrets = getInputList("secrets", { ignoreComma: true });
  const secretEnvs = getInputList("secret_envs");
  const secretFiles = getInputList("secret_files", { ignoreComma: true });
  const shouldPush = core.getBooleanInput("push");

  return {
    localConfigPath,
    registry,
    projectId,
    repoName,
    commitSha,
    branchName,
    serviceFilter,
    buildArgs,
    secrets,
    secretEnvs,
    secretFiles,
    shouldPush
  } satisfies ParsedInputs;
}

export async function main() {
  try {
    const {
      localConfigPath,
      registry,
      projectId,
      repoName,
      commitSha,
      branchName,
      serviceFilter,
      buildArgs,
      secrets,
      secretEnvs,
      secretFiles,
      shouldPush
    } = getInputs();

    const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const configFile = resolve(workspaceRoot, localConfigPath);
    const configDir = dirname(configFile);

    core.info(`Reading config from: ${configFile}`);

    const configContent = await readFile(configFile, "utf-8");
    const rawConfig = JSON.parse(configContent);
    const config = BuildConfigSchema.parse(rawConfig);

    const environments = config.environments ?? ["main"];
    if (shouldPush && !environments.includes(branchName)) {
      core.info(
        `Branch "${branchName}" is not in the configured environments [${environments.join(", ")}]. Skipping build.`,
      );
      return;
    }

    const context: BuildContext = {
      registry,
      projectId,
      repoName,
      commitSha,
      branchName,
      buildArgs,
      secrets,
      secretEnvs,
      secretFiles,
      shouldPush
    };

    await buildAll(config, context, configDir, serviceFilter);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("Unknown error occurred");
    }
  }
}
