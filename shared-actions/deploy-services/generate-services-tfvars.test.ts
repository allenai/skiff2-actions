import { beforeEach, expect, test, vi } from "vitest";
import { generateServicesTFVars } from "./generate-services-tfvars";
import { stubGithubActionInput } from "../test-util/stub-github-action-input";
import { vol, fs } from "memfs";
import path from "path";
import type { TempFileContext } from "../build/secrets";
import type { BuildConfig, ServiceConfig } from "../shared/skiff2-config";

vi.mock("node:fs");
vi.mock("node:fs/promises");

beforeEach(() => {
  vol.reset();
});

const fakeConfig = {
  projectName: "skiff2-test-build",
  environments: ["main"],
  services: [
    {
      name: "generate-service-test",
      cwd: ".",
      dockerFile: "build-test.Dockerfile",
      isRootService: true,
      allowUnauthenticated: true,
      allowDelete: true,
      secretFiles: {},
      customDomains: [],
      machine: {
        minInstances: 5,
        maxInstances: 20,
        memory: "2Gi",
        cpu: 5,
        cpuIdle: false,
      },
      startup: {
        initialDelaySeconds: 60,
        timeoutSeconds: 10,
        periodSeconds: 30,
        failureThreshold: 20,
        path: "startup",
        port: 3000,
      },
      liveness: {
        initialDelaySeconds: 10,
        timeoutSeconds: 20,
        periodSeconds: 30,
        failureThreshold: 40,
        path: "liveness",
        port: 4000,
      },
    },
  ],
} as const satisfies BuildConfig;

test("generateServicesTFVars maps correctly", async () => {
  stubGithubActionInput("config_file", "/fake-config-file.json");
  stubGithubActionInput("project_id", "fake-skiff-project");
  stubGithubActionInput("region", "fake-region");
  stubGithubActionInput("repo_name", "skiff-commodore-fake");

  fs.writeFileSync("/fake-config-file.json", JSON.stringify(fakeConfig));

  fs.mkdirSync("/terraform");
  vi.stubEnv("TERRAFORM_DIR", "/terraform");

  await generateServicesTFVars();

  const fileContents = fs.readFileSync(
    "/terraform/generated.auto.tfvars.json",
    { encoding: "utf-8" },
  ) as string;
  const parsedFileContents = JSON.parse(fileContents);

  expect(parsedFileContents).toEqual({
    project_id: "fake-skiff-project",
    region: "fake-region",
    services: {
      "generate-service-test": {
        name: "generate-service-test",
        container_name: "skiff-commodore-fake-generate-service-test",
        allow_unauthenticated: true,
        allow_delete: true,
        secret_files: {},
        custom_domains: [],
        image_tag: "main",
        deployment_environment: "prod",
        machine: {
          min_instances: 5,
          max_instances: 20,
          memory: "2Gi",
          cpu: "5",
          cpu_idle: false,
        },
        startup: {
          initial_delay_seconds: 60,
          timeout_seconds: 10,
          period_seconds: 30,
          failure_threshold: 20,
          path: "startup",
          port: 3000,
        },
        liveness: {
          initial_delay_seconds: 10,
          timeout_seconds: 20,
          period_seconds: 30,
          failure_threshold: 40,
          path: "liveness",
          port: 4000,
        },
      },
    },
  });
});
