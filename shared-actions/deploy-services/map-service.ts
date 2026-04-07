import type { ServiceConfig } from "../shared/skiff2-config";

interface ProbeConfig {
  initial_delay_seconds?: number;
  timeout_seconds?: number;
  period_seconds?: number;
  failure_threshold?: number;
  path?: string;
  port?: number;
}

interface Container {
  name: string;
  container_name: string;
  secret_files: Record<string, string>;

  egress_port?: number;

  vpc?: {
    network: string;
    subnetwork: string;
    egress: string;
  };

  machine: {
    memory: string;
    cpu: string;
    cpu_idle: boolean;
  };

  startup: ProbeConfig;
  liveness: ProbeConfig;

  http_version?: "h2c" | "http1";
}

function mapContainer(
  serviceConfig: ServiceConfig,
  repoName: string,
): Container | undefined {
  const container: Container = {
    name: serviceConfig.name,
    container_name: `${repoName}-${serviceConfig.name}`,
    secret_files: serviceConfig.secretFiles,
    http_version: serviceConfig.httpVersion === "2" ? "h2c" : "http1",
    machine: {
      memory: serviceConfig.machine.memory,
      cpu: String(serviceConfig.machine.cpu),
      cpu_idle: serviceConfig.machine.cpuIdle,
    },
    startup: {
      initial_delay_seconds: serviceConfig.startup.initialDelaySeconds,
      timeout_seconds: serviceConfig.startup.timeoutSeconds,
      period_seconds: serviceConfig.startup.periodSeconds,
      failure_threshold: serviceConfig.startup.failureThreshold,
      path: serviceConfig.startup.path,
      port: serviceConfig.startup.port,
    },
    liveness: {
      initial_delay_seconds: serviceConfig.liveness.initialDelaySeconds,
      timeout_seconds: serviceConfig.liveness.timeoutSeconds,
      period_seconds: serviceConfig.liveness.periodSeconds,
      failure_threshold: serviceConfig.liveness.failureThreshold,
      path: serviceConfig.liveness.path,
      port: serviceConfig.liveness.port,
    },
  };

  if (serviceConfig.vpc) {
    container.vpc = serviceConfig.vpc;
  }

  return container;
}

export interface ServiceEntry {
  name: string;
  containers: Record<string, Container>;

  image_tag: string;
  allow_unauthenticated: boolean;
  allow_delete: boolean;
  min_instances: number;
  max_instances: number;
}

interface MapServiceAdditionalInput {
  serviceMap: Map<string, ServiceConfig>;
  servicesToDeploy: string;
  repoName: string;
  imageTag: string;
  isMainBranch: boolean;
  deploymentEnv: string;
}

function mapService(
  serviceConfig: ServiceConfig,
  { serviceMap, repoName, imageTag }: MapServiceAdditionalInput,
): ServiceEntry | undefined {
  const sidecarServices =
    serviceConfig.additionalContainers?.map((additionalContainerName) => {
      const service = serviceMap.get(additionalContainerName);

      if (service == null) {
        throw new Error(
          `Service config for additional container not found. Service: ${serviceConfig.name}, Missing service: ${additionalContainerName})}`,
        );
      } else {
        return service;
      }
    }) ?? [];

  const allConfigsForService = [serviceConfig, ...sidecarServices];
  const containers = allConfigsForService.reduce(
    (acc, service) => {
      const mappedContainer = mapContainer(service, repoName);

      if (mappedContainer) {
        acc[service.name] = mappedContainer;
      }

      return acc;
    },
    {} as Record<string, Container>,
  );

  const service: ServiceEntry = {
    name: serviceConfig.name,
    containers,
    image_tag: imageTag,
    allow_unauthenticated: serviceConfig.allowUnauthenticated,
    allow_delete: serviceConfig.allowDelete,
    min_instances: serviceConfig.machine.minInstances,
    max_instances: serviceConfig.machine.maxInstances,
  };

  return service;
}

export function mapServices(
  services: ServiceConfig[],
  additionalInput: Omit<MapServiceAdditionalInput, "serviceMap">,
): Record<string, ServiceEntry> {
  const serviceFilter =
    additionalInput.servicesToDeploy
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? null;

  // Validate filtered service names exist in the config
  if (serviceFilter) {
    const configServiceNames = services
      .filter((s) => s.deploy !== false)
      .map((s) => s.name);

    const unknownServices = serviceFilter.filter(
      (name) => !configServiceNames.includes(name),
    );

    if (unknownServices.length > 0) {
      throw new Error(
        `Unknown services specified: ${unknownServices.join(", ")}`,
      );
    }
  }

  const serviceMap = services.reduce<Map<string, ServiceConfig>>(
    (acc, service) => {
      acc.set(service.name, service);
      return acc;
    },
    new Map(),
  );

  const mappedServices = Object.values(services).reduce<
    Record<string, ServiceEntry>
  >((acc, serviceConfig) => {
    const mappedService = mapService(serviceConfig, {
      serviceMap,
      ...additionalInput,
    });

    if (serviceFilter && serviceFilter.includes(serviceConfig.name)) {
      return acc;
    }

    if (!serviceConfig.deploy) {
      return acc;
    }

    const serviceKey = additionalInput.isMainBranch
      ? serviceConfig.name
      : `${additionalInput.deploymentEnv}-${serviceConfig.name}`;

    if (mappedService) {
      acc[serviceKey] = mappedService;
    }

    return acc;
  }, {});

  return mappedServices;
}
