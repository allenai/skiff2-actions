import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";
import type { BuildConfig } from "../shared/skiff2-config";
import { stubGithubActionInput } from "../test-util/stub-github-action-input";
import { generateServicesTFVars } from "./generate-services-tfvars";

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
      deploy: true,
      isRootService: true,
      allowUnauthenticated: true,
      allowedPrincipals: ["domain:allenai.org"],
      allowDelete: true,
      secretFiles: {},
      customDomains: [],
      httpVersion: "2",
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
        path: "liveness",
        port: 4000,
      },
      sidecars: [
        {
          name: "generate-service-test-sidecar",
          cwd: "./sidecar",
          dockerFile: "sidecar.Dockerfile",
          secretFiles: {},
          machine: {
            memory: "512Mi",
            cpu: 1,
            cpuIdle: true,
          },
          startup: {
            initialDelaySeconds: 1,
            timeoutSeconds: 2,
            periodSeconds: 3,
            failureThreshold: 4,
            path: "sidecar-startup",
            port: 5,
          }
        },
      ],
    },
    {
      name: "filteredService",
      cwd: "filtered",
      deploy: true,
      dockerFile: "filtered.Dockerfile",
      httpVersion: "2",
      isRootService: false,
      allowUnauthenticated: false,
      allowedPrincipals: ["domain:allenai.org"],
      allowDelete: false,
      secretFiles: {},
      customDomains: [],
      machine: {
        minInstances: 1,
        maxInstances: 2,
        memory: "512Mi",
        cpu: 1,
        cpuIdle: true,
      },
      startup: {},
      liveness: {},
    },
  ],
  remoteServices: [
    {
      name: "remoteService",
      customDomains: [],
    }
  ]
} as const satisfies BuildConfig;

test("generateServicesTFVars maps correctly", async () => {
  stubGithubActionInput("config_file", "/fake-config-file.json");
  stubGithubActionInput("project_id", "fake-skiff-project");
  stubGithubActionInput("region", "fake-region");
  stubGithubActionInput("repo_name", "skiff-commodore-fake");
  stubGithubActionInput("services", "generate-service-test");
  stubGithubActionInput("deploy_tag", "main");

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
    deployment_environment: "prod",
    image_tag: "main",
    project_id: "fake-skiff-project",
    region: "fake-region",
    services: {
      "generate-service-test": {
        allow_delete: true,
        allow_unauthenticated: true,
        allowed_principals: ["domain:allenai.org"],
        containers: [
          {
            container_name: "skiff-commodore-fake-generate-service-test",
            liveness: {
              initial_delay_seconds: 10,
              path: "liveness",
              period_seconds: 30,
              port: 4000,
              timeout_seconds: 20,
            },
            machine: {
              cpu: "5",
              cpu_idle: false,
              memory: "2Gi",
            },
            name: "generate-service-test",
            port: {
              name: "h2c",
              port: 8080,
            },

            secret_files: {},
            startup: {
              failure_threshold: 20,
              initial_delay_seconds: 60,
              path: "startup",
              period_seconds: 30,
              port: 3000,
              timeout_seconds: 10,
            },
          },
          {
            container_name:
              "skiff-commodore-fake-generate-service-test-sidecar",
            machine: {
              cpu: "1",
              cpu_idle: true,
              memory: "512Mi",
            },
            name: "generate-service-test-sidecar",
            secret_files: {},
            startup: {
              failure_threshold: 4,
              initial_delay_seconds: 1,
              path: "sidecar-startup",
              period_seconds: 3,
              port: 5,
              timeout_seconds: 2,
            },
          },
        ],
        image_tag: "main",
        max_instances: 20,
        min_instances: 5,
        name: "generate-service-test",
      },
    },
  });
});
