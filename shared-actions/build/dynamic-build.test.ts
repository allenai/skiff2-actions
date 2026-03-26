import { fs, vol } from "memfs";
import type { ServiceConfig } from "../shared/skiff2-config.ts";
import {
  getInputs,
  buildDockerArgs,
  type BuildContext,
} from "./dynamic-build.ts";
import { test, vi, expect, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("node:fs/promises");

beforeEach(() => {
  vol.reset();
});

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
  stubGithubActionInput(
    "secret_files",
    "secret_file=./secret_credentials\nsecret_two=../not_credentials.py",
  );

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
    secretFiles: [
      "secret_file=./secret_credentials",
      "secret_two=../not_credentials.py",
    ],
  } satisfies ReturnType<typeof getInputs>);
});

test("buildDockerArgs maps correctly", () => {
  const testService = {
    name: "service",
    cwd: "/foo",
    isRootService: true,
    dockerFile: ".Dockerfile",
    allowUnauthenticated: false,
    allowDelete: false,
    secretFiles: { "run/secret/secret_file": "secret_file" },
    customDomains: [],
    machine: {
      minInstances: 1,
      maxInstances: 10,
      memory: "512Mi",
      cpu: 1,
      cpuIdle: true,
    },
  } satisfies ServiceConfig;

  const testContext = {
    registry: "fake-registry",
    projectId: "project",
    repoName: "skiff-commodore-fake",
    commitSha: "SHA",
    branchName: "branch",
    buildArgs: ["ARG_ONE=1", "SECOND_ARG=two"],
    secretEnvs: ["first_env=foo", "env_two=2"],
    secretFiles: ["creds=/credentials"],
  } satisfies BuildContext;

  fs.writeFileSync("/credentials", "foo");

  const args = buildDockerArgs(testService, testContext, ".", ["fake-tag"]);

  expect(args).toEqual([
    "buildx",
    "build",
    "--push",
    "--cache-from",
    "type=registry,ref=fake-registry/project/skiff-commodore-fake-service:latest",
    "--cache-to",
    "type=inline",
    "--build-arg",
    "BUILDKIT_INLINE_CACHE=1",
    "--build-arg",
    "ARG_ONE=1",
    "--build-arg",
    "SECOND_ARG=two",
    "--secret",
    "id=first_env,env=foo",
    "--secret",
    "id=env_two,env=2",
    "--secret",
    "id=creds,src=/credentials",
    "--tag",
    "fake-tag",
    "--file",
    "/foo/.Dockerfile",
    "/foo",
  ]);
});
