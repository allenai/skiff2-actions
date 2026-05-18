import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";
import type { BuildConfigInput } from "../shared/skiff2-config";
import { stubGithubActionInput } from "../test-util/stub-github-action-input";
import { generateInfraTFVars } from "./generate-infra-tfvars";

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
      name: "infra-test",
      cwd: ".",
      dockerFile: "build-test.Dockerfile",
      deploy: true,
      isRootService: true,
      allowUnauthenticated: true,
      allowedPrincipals: ["domain:allenai.org"],
      allowDelete: true,
      secretFiles: {},
      customDomains: ["foo.pandajungle.org"],
      httpVersion: "2",
      serviceAccount: "service.account@project.google.com",
      includeDNSAuthorizationForExternalDomains: true,
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
          name: "infra-sidecar",
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
      name: "no-dns-auth-svc",
      includeDNSAuthorizationForExternalDomains: false,
      cwd: ".",
      deploy: true,
      customDomains: ["no-dns-auth.pandajungle.org"],
    },
  ],
  remoteServices: [
    {
      name: "remote-dns-auth",
      customDomains: ["remote-dns-auth.pandajungle.org"],
      includeDNSAuthorizationForExternalDomains: true
    },
  ],
} as const satisfies BuildConfigInput;

test("generateInfraTFVars maps correctly", async () => {
  stubGithubActionInput("config_file", "/fake-config-file.json");
  stubGithubActionInput("project_id", "fake-skiff-project");
  stubGithubActionInput("region", "fake-region");
  stubGithubActionInput("use_classic_load_balancer", "false");

  fs.writeFileSync("/fake-config-file.json", JSON.stringify(fakeConfig));

  fs.mkdirSync("/terraform");
  vi.stubEnv("TERRAFORM_DIR", "/terraform");

  await generateInfraTFVars();

  const fileContents = fs.readFileSync(
    "/terraform/generated.auto.tfvars.json",
    { encoding: "utf-8" },
  ) as string;
  const parsedFileContents = JSON.parse(fileContents);

  expect(parsedFileContents).toEqual({
    branch_environments: [],
    custom_domain_mappings: {
      "foo.pandajungle.org": {
        include_dns_authorization_for_external_domains: true,
        service_name: "prod-infra-test",
      },
      "no-dns-auth.pandajungle.org": {
        include_dns_authorization_for_external_domains: false,
        service_name: "prod-no-dns-auth-svc",
      },
      "remote-dns-auth.pandajungle.org": {
        include_dns_authorization_for_external_domains: true,
        service_name: "prod-remote-dns-auth",
      },
    },
    default_service: "infra-test",
    project_id: "fake-skiff-project",
    region: "fake-region",
    use_classic_load_balancer: false,
  });
});
