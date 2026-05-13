import { fs, vol } from "memfs";
import type { BuildConfigInput, ServiceConfig } from "../shared/skiff2-config.ts";
import {
  getInputs,
  buildDockerArgs,
  type BuildContext,
  main,
} from "./dynamic-build.ts";
import { test, vi, expect, beforeEach, assert } from "vitest";
import { TempFileContext } from "./secrets.ts";
import path, { resolve } from "path";
import { stubGithubActionInput } from "../test-util/stub-github-action-input.ts";
import * as exec from "@actions/exec";
import * as core from "@actions/core";

vi.mock("node:fs");
vi.mock("node:fs/promises");

beforeEach(() => {
  vol.reset();
  vi.unstubAllEnvs();

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
    allowedPrincipals: ["domain:allenai.org"],
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
    startup: {},
    liveness: {},
    deploy: true,
    httpVersion: "1",
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
      "type=registry,ref=${DOCKER_REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}:${BRANCH}-cache",
    cacheTo:
      "type=registry,ref=${DOCKER_REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}:${BRANCH}-cache",
  } satisfies BuildContext;

  fs.writeFileSync("/credentials", "foo");

  const args = buildDockerArgs(testService, testContext, ".", ["fake-tag"]);

  expect(args).toEqual([
    "buildx",
    "build",
    "--push",
    "--cache-from",
    "type=registry,ref=fake-registry/project/skiff-commodore-fake-service:branch-cache",
    "--cache-to",
    "type=registry,ref=fake-registry/project/skiff-commodore-fake-service:branch-cache",
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

test("builds with sidecars and multiple services", async () => {
  const execSpy = vi
    .spyOn(exec, "exec")
    .mockImplementation((commandLine, args, options) => {
      return Promise.resolve(0);
    });

  vi.spyOn(core, "setFailed").mockImplementation((message) => {
    console.error(message);

    if (message instanceof Error) {
      throw message;
    } else {
      throw new Error(message);
    }
  });

  const CONFIG_FILE_NAME = "fake-build-config.json";
  const CONFIG_FILE_DIRECTORY = "/test";
  const configPath = resolve(CONFIG_FILE_DIRECTORY, CONFIG_FILE_NAME);

  stubGithubActionInput("config_file", configPath);
  stubGithubActionInput("registry", "fake-docker-registry");
  stubGithubActionInput("project_id", "fake-skiff-project");
  stubGithubActionInput("repo_name", "skiff-commodore-fake");
  stubGithubActionInput("commit_sha", "SHA");
  stubGithubActionInput("branch_name", "branch");
  stubGithubActionInput("push", "false");

  const buildConfig = {
    projectName: "test-project",
    environments: ["main"],
    services: [
      {
        name: "service",
        cwd: "/foo",
        isRootService: true,
        dockerFile: ".Dockerfile",
        allowUnauthenticated: false,
        allowedPrincipals: ["domain:allenai.org"],
        allowDelete: false,
        secretFiles: {},
        customDomains: [],
        machine: {
          minInstances: 1,
          maxInstances: 10,
          memory: "512Mi",
          cpu: 1,
          cpuIdle: true,
        },
        startup: {},
        liveness: {},
        deploy: true,
        httpVersion: "1",
        secondaryImage: 'serviceTwo',
        sidecars: [
          {
            name: "sidecar",
            cwd: "sidecar",
            secretFiles: {},
            machine: {
              memory: "1",
              cpu: 1,
              cpuIdle: true,
            },
          },
        ],
      },
      {
        name: "serviceTwo",
        cwd: "/two",
        isRootService: true,
        dockerFile: ".Dockerfile",
        allowUnauthenticated: false,
        allowedPrincipals: ["domain:allenai.org"],
        allowDelete: false,
        secretFiles: {},
        customDomains: [],
        machine: {
          minInstances: 1,
          maxInstances: 10,
          memory: "512Mi",
          cpu: 1,
          cpuIdle: true,
        },
        startup: {},
        liveness: {},
        deploy: false,
        httpVersion: "1",
      },
    ],
  } satisfies BuildConfigInput;

  fs.mkdirSync(CONFIG_FILE_DIRECTORY);
  fs.writeFileSync(resolve(configPath), JSON.stringify(buildConfig));
  await main();

  expect(execSpy).toHaveBeenCalledTimes(3);
  expect(execSpy).toHaveBeenCalledWith("docker", [
    "buildx",
    "build",
    "--tag",
    "fake-docker-registry/fake-skiff-project/skiff-commodore-fake-service:SHA",
    "--tag",
    "fake-docker-registry/fake-skiff-project/skiff-commodore-fake-service:branch",
    "--file",
    "/foo/.Dockerfile",
    "/foo",
  ]);
  expect(execSpy).toHaveBeenCalledWith("docker", [
    "buildx",
    "build",
    "--tag",
    "fake-docker-registry/fake-skiff-project/skiff-commodore-fake-sidecar:SHA",
    "--tag",
    "fake-docker-registry/fake-skiff-project/skiff-commodore-fake-sidecar:branch",
    "/test/sidecar",
  ]);
  expect(execSpy).toHaveBeenCalledWith("docker", [
    "buildx",
    "build",
    "--tag",
    "fake-docker-registry/fake-skiff-project/skiff-commodore-fake-serviceTwo:SHA",
    "--tag",
    "fake-docker-registry/fake-skiff-project/skiff-commodore-fake-serviceTwo:branch",
    "--file",
    "/two/.Dockerfile",
    "/two",
  ]);
});
