import { fs, vol } from "memfs";
import type { ServiceConfig } from "../shared/skiff2-config.ts";
import {
  getInputs,
  buildDockerArgs,
  type BuildContext,
} from "./dynamic-build.ts";
import { test, vi, expect, beforeEach } from "vitest";
import { TempFileContext } from "./secrets.ts";
import path from "path";

vi.mock("node:fs");
vi.mock("node:fs/promises");

beforeEach(() => {
  vol.reset();

  const tmpDir = fs.mkdtempSync("/temp-context-").toString();
  const tmpName = path.join(tmpDir, ".tmpname-vi");

  vi.spyOn(TempFileContext, "tmpDir").mockImplementation((): string => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
  });

  vi.spyOn(TempFileContext, "tmpName").mockImplementation((): string => {
    return tmpName;
  });
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
  stubGithubActionInput("build_args", "FIRST_ARG=foo\nSECOND_ARG=bar,");
  stubGithubActionInput("secrets", "github_token=12345\nanother_secret=fo,o");
  stubGithubActionInput("secret_envs", "secret_one=1\nsecret_two=foo");
  stubGithubActionInput(
    "secret_files",
    "secret_file=./secret_credentials\nsecret_two=../not_credentials.py",
  );
  stubGithubActionInput("push", "true");
  stubGithubActionInput(
    "cache_from",
    "type=registry,ref=${DOCKER_REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}:latest",
  );
  stubGithubActionInput("cache_to", "type=inline");

  const parsedInputs = getInputs();
  expect(parsedInputs).toEqual({
    localConfigPath: "fake-config-file.json",
    registry: "fake-docker-registry",
    projectId: "fake-skiff-project",
    repoName: "skiff-commodore-fake",
    commitSha: "SHA",
    branchName: "branch",
    serviceFilter: ["service1", "service2", "serviceFoo"],
    buildArgs: ["FIRST_ARG=foo", "SECOND_ARG=bar,"],
    secrets: ["github_token=12345", "another_secret=fo,o"],
    secretEnvs: ["secret_one=1", "secret_two=foo"],
    secretFiles: [
      "secret_file=./secret_credentials",
      "secret_two=../not_credentials.py",
    ],
    shouldPush: true,
    cacheFrom:
      "type=registry,ref=${DOCKER_REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}:latest",
    cacheTo: "type=inline",
  } satisfies ReturnType<typeof getInputs>);
});

const getFakeServiceConfig = () =>
  ({
    name: "service",
    cwd: "/foo",
    isRootService: true,
    dockerFile: ".Dockerfile",
    allowUnauthenticated: false,
    allowDelete: false,
    secretFiles: { "run/secret/secret_file": "secret_file" },
    extraBuildArgs: [
      "--build-arg",
      "UI_IMAGE=gcr.io/${PROJECT_ID}/${REPO_NAME}-ui:${COMMIT_SHA}",
      "--arg",
    ],
    customDomains: [],
    machine: {
      minInstances: 1,
      maxInstances: 10,
      memory: "512Mi",
      cpu: 1,
      cpuIdle: true,
    },
  }) satisfies ServiceConfig;

test("buildDockerArgs maps correctly", () => {
  const testService = getFakeServiceConfig();

  const testContext = {
    registry: "fake-registry",
    projectId: "project",
    repoName: "skiff-commodore-fake",
    commitSha: "SHA",
    branchName: "branch",
    buildArgs: ["ARG_ONE=1", "SECOND_ARG=two"],
    secrets: ["secret_token=12345"],
    secretEnvs: ["first_env=foo", "env_two=2"],
    secretFiles: ["creds=/credentials"],
    shouldPush: true,
    cacheFrom:
      "type=registry,ref=${DOCKER_REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}:latest",
    cacheTo:
      "type=registry,ref=${DOCKER_REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}:latest",
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
    "type=registry,ref=fake-registry/project/skiff-commodore-fake-service:latest",
    "--build-arg",
    "UI_IMAGE=gcr.io/project/skiff-commodore-fake-ui:SHA",
    "--arg",
    "--build-arg",
    "ARG_ONE=1",
    "--build-arg",
    "SECOND_ARG=two",
    "--secret",
    expect.stringMatching(
      /id=secret_token,src=\/temp-context-\w*\/\.tmpname-vi$/,
    ),
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

test("buildDockerArgs does not include push when shouldPush==false", () => {
  const testService = getFakeServiceConfig();

  const testContext = {
    registry: "fake-registry",
    projectId: "project",
    repoName: "skiff-commodore-fake",
    commitSha: "SHA",
    branchName: "branch",
    buildArgs: null,
    secrets: null,
    secretEnvs: null,
    secretFiles: null,
    shouldPush: false,
    cacheFrom:
      "type=registry,ref=${DOCKER_REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}:latest",
    cacheTo: "type=inline",
  } satisfies BuildContext;

  fs.writeFileSync("/credentials", "foo");

  const args = buildDockerArgs(testService, testContext, ".", ["fake-tag"]);

  expect(args).not.toContain("--push");
});
