import * as core from "@actions/core";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { BuildConfigSchema } from "../shared/skiff2-config.ts";
import { sanitizeBranchTag } from "../shared/utils.ts";

async function listActiveEnvironments() {
  const configPath = core.getInput("config_file", { required: true });
  const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
  const configFile = resolve(workspaceRoot, configPath);
  const config = BuildConfigSchema.parse(
    JSON.parse(await readFile(configFile, "utf-8")),
  );

  const allEnvironments = config.environments ?? ["main"];
  const activeEnvironments = allEnvironments.map((env) =>
    env === "main" ? "default" : sanitizeBranchTag(env),
  );

  process.stdout.write(activeEnvironments.join("\n") + "\n");
}

listActiveEnvironments().catch((error) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else {
    core.setFailed("Unknown error occurred");
  }
});
