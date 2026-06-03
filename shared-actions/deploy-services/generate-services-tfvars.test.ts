import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";
import type { BuildConfigInput } from "../shared/skiff2-config";
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
      name: "gen-svc-test",
      cwd: ".",
      dockerFile: "build-test.Dockerfile",
      deploy: true,
      isRootService: true,
      allowUnauthenticated: true,
      allowedPrincipals: ["domain:allenai.org"],
      allowDelete: true,
      secretFiles: {},
      ephemeralStorage: {
        "/tmp/cache": "10Gi",
      },
      customDomains: [],
      httpVersion: "2",
      serviceAccount: "service.account@project.google.com",
      runtimeDependsOn: ["gen-svc-sidecar"],
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
          name: "gen-svc-sidecar",
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
          },
        },
      ],
    },
    {
      name: "no-svc-account",
      cwd: ".",
      deploy: true,
      httpVersion: "1",
      isRootService: false,
      allowUnauthenticated: false,
      allowedPrincipals: [],
      allowDelete: false,
      secretFiles: {},
      customDomains: [],
      machine: {
        minInstances: 1,
        maxInstances: 2,
        memory: "512Mi",
        cpu: 0.08,
        cpuIdle: true,
      },
      startup: {},
      liveness: {},
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
    },
  ],
} as const satisfies BuildConfigInput;

test("generateServicesTFVars maps correctly", async () => {
  stubGithubActionInput("config_file", "/fake-config-file.json");
  stubGithubActionInput("project_id", "fake-skiff-project");
  stubGithubActionInput("region", "fake-region");
  stubGithubActionInput("repo_name", "skiff-commodore-fake");
  stubGithubActionInput(
    "services",
    "gen-svc-test, no-svc-account",
  );
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
      "gen-svc-test": {
        allow_delete: true,
        allow_unauthenticated: true,
        allowed_principals: ["domain:allenai.org"],
        containers: [
          {
            container_name: "skiff-commodore-fake-gen-svc-test",
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
            name: "gen-svc-test",
            port: {
              name: "h2c",
              port: 8080,
            },

            secret_files: {},
            ephemeral_storage: {
              "/tmp/cache": "10Gi",
            },
            startup: {
              failure_threshold: 20,
              initial_delay_seconds: 60,
              path: "startup",
              period_seconds: 30,
              port: 3000,
              timeout_seconds: 10,
            },
            depends_on: ["gen-svc-sidecar"]
          },
          {
            container_name:
              "skiff-commodore-fake-gen-svc-sidecar",
            machine: {
              cpu: "1",
              cpu_idle: true,
              memory: "512Mi",
            },
            name: "gen-svc-sidecar",
            secret_files: {},
            ephemeral_storage: {},
            startup: {
              failure_threshold: 4,
              initial_delay_seconds: 1,
              path: "sidecar-startup",
              period_seconds: 3,
              port: 5,
              timeout_seconds: 2,
            },
            depends_on: []
          },
        ],
        image_tag: "main",
        max_instances: 20,
        min_instances: 5,
        name: "gen-svc-test",
        service_account: "service.account@project.google.com",
      },
      "no-svc-account": {
        allow_delete: false,
        allow_unauthenticated: false,
        allowed_principals: [],
        containers: [
          {
            container_name: "skiff-commodore-fake-no-svc-account",
            liveness: {},
            machine: {
              cpu: "0.08",
              cpu_idle: true,
              memory: "512Mi",
            },
            name: "no-svc-account",
            port: {
              name: "http1",
              port: 8080,
            },
            secret_files: {},
            ephemeral_storage: {},
            startup: {},
            depends_on: []
          },
        ],
        image_tag: "main",
        max_instances: 2,
        min_instances: 1,
        name: "no-svc-account",
      },
      filteredService: {
        allow_delete: false,
        allow_unauthenticated: false,
        allowed_principals: ["domain:allenai.org"],
        containers: [
          {
            container_name: "skiff-commodore-fake-filteredService",
            machine: {
              cpu: "1",
              cpu_idle: true,
              memory: "512Mi",
            },
            name: "filteredService",
            port: {
              name: "h2c",
              port: 8080,
            },
            secret_files: {},
            ephemeral_storage: {},
            startup: {},
            liveness: {},
            depends_on: []
          },
        ],
        image_tag: "main",
        max_instances: 2,
        min_instances: 1,
        name: "filteredService",
      },
    },
  });
});
