import { getInputs, main } from "./dynamic-build.ts";
import { test, vi, expect } from "vitest";

function stubGithubActionInput(inputName: string, value: string) {
  vi.stubEnv(`INPUT_${inputName.toUpperCase()}`, value);
}

test("getInputs parses correctly", () => {
  stubGithubActionInput("config_file", "fake-config-file.json");
  stubGithubActionInput("registry", "fake-docker-registry");
  stubGithubActionInput("project_id", "fake-skiff-project");
  stubGithubActionInput("repo_name", "skiff-commodore-fake");
  stubGithubActionInput("commit_sha", "SHA");
  stubGithubActionInput("branch_name", "branch");
  stubGithubActionInput("services", "service1, service2, serviceFoo");
  stubGithubActionInput("build_args", "FIRST_ARG=foo\nSECOND_ARG=bar");
  stubGithubActionInput("secret_envs", "secret_one=1\nsecret_two=foo");

  const parsedInputs = getInputs();
  expect(parsedInputs).toEqual({
    localConfigPath: "fake-config-file.json",
    registry: "fake-docker-registry",
    projectId: "fake-skiff-project",
    repoName: "skiff-commodore-fake",
    commitSha: "SHA",
    branchName: "branch",
    serviceFilter: ["service1", "service2", "serviceFoo"],
    buildArgs: ["FIRST_ARG=foo", "SECOND_ARG=bar"],
    secretEnvs: ["secret_one=1", "secret_two=foo"],
  } satisfies ReturnType<typeof getInputs>);
});
