import * as core from "@actions/core";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { BuildConfigSchema } from "./skiff2-config.ts";
import { computeAllowDelete } from "./utils.ts";

async function main() {
  const configPath = core.getInput("config_file", { required: true });
  const branch = process.env.INPUT_BRANCH;

  if (!branch) {
    throw new Error("INPUT_BRANCH environment variable is required");
  }

  const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
  const configFile = resolve(workspaceRoot, configPath);
  const config = BuildConfigSchema.parse(
    JSON.parse(await readFile(configFile, "utf-8")),
  );

  const allEnvironments = config.environments ?? ["main"];
  const isLongLived = allEnvironments.includes(branch);

  const protectedServices = config.services
    .filter((s) => s.deploy !== false)
    .filter((s) => !computeAllowDelete(s, isLongLived));

  if (protectedServices.length > 0) {
    const names = protectedServices.map((s) => s.name).join(", ");
    const reason = isLongLived
      ? `This is a long-lived environment. Set allowDelete: true on these services, or remove "${branch}" from the environments list and deploy main.`
      : `Set allowDelete: true on these services to allow deletion.`;
    core.setOutput("deletable", "false");
    core.setOutput("reason", `Services with deletion protection: ${names}. ${reason}`);
    core.warning(`Cannot delete environment "${branch}": ${names}`);
    process.exitCode = 1;
  } else {
    core.setOutput("deletable", "true");
    core.setOutput("reason", "");
    core.info(`Environment "${branch}" is deletable.`);
  }
}

main().catch((error) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else {
    core.setFailed("Unknown error occurred");
  }
});
