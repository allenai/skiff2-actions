import type { ContainerConfig, ServiceConfig } from "../shared/skiff2-config";

interface ProbeConfig {
  initial_delay_seconds?: number;
  timeout_seconds?: number;
  period_seconds?: number;
  failure_threshold?: number;
  path?: string;
  port?: number;
}

interface PortConfig {
  name: "h2c" | "http1";
  port: number;
}

interface Container {
  name: string;
  container_name: string;
  secret_files: Record<string, string>;

  port?: PortConfig;

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
}

function baseMapToContainer(
  config: ServiceConfig | ContainerConfig,
  repoName: string,
): Container {
  const container: Container = {
    name: config.name,
    container_name: `${repoName}-${config.name}`,
    secret_files: config.secretFiles,
    machine: {
      memory: config.machine.memory,
      cpu: String(config.machine.cpu),
      cpu_idle: config.machine.cpuIdle,
    },
    startup: {
      initial_delay_seconds: config.startup.initialDelaySeconds,
      timeout_seconds: config.startup.timeoutSeconds,
      period_seconds: config.startup.periodSeconds,
      failure_threshold: config.startup.failureThreshold,
      path: config.startup.path,
      port: config.startup.port,
    },
    liveness: {
      initial_delay_seconds: config.liveness.initialDelaySeconds,
      timeout_seconds: config.liveness.timeoutSeconds,
      period_seconds: config.liveness.periodSeconds,
      failure_threshold: config.liveness.failureThreshold,
      path: config.liveness.path,
      port: config.liveness.port,
    },
  };

  if (config.vpc) {
    container.vpc = config.vpc;
  }

  return container;
}

function mapServiceToContainer(
  serviceConfig: ServiceConfig,
  repoName: string,
): Container | undefined {
  const container = baseMapToContainer(serviceConfig, repoName);
  if (serviceConfig.deploy) {
    container.port = {
      name: serviceConfig.httpVersion === "2" ? "h2c" : "http1",
      port: 8080,
    };
  }

  return container;
}

function mapSidecarToContainer(
  sidecar: ContainerConfig,
  repoName: string,
): Container {
  return baseMapToContainer(sidecar, repoName);
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
  const sidecarContainers =
    serviceConfig.sidecars?.reduce<Record<string, Container>>(
      (acc, sidecar) => {
        acc[sidecar.name] = mapSidecarToContainer(sidecar, repoName);
        return acc;
      },
      {},
    ) ?? {};

  const secondaryImageContainer = serviceConfig.secondaryImage
    ? serviceMap.get(serviceConfig.secondaryImage)
    : null;
  if (serviceConfig.secondaryImage && secondaryImageContainer == null) {
    throw new Error(
      `Service config for secondary image not found. Service: ${serviceConfig.name}, Missing service: ${serviceConfig.secondaryImage})}`,
    );
  }

  const allConfigsForService = [
    serviceConfig,
    ...(secondaryImageContainer ? [secondaryImageContainer] : []),
  ];
  const mappedServices = allConfigsForService.reduce<Record<string, Container>>(
    (acc, service) => {
      const mappedContainer = mapServiceToContainer(service, repoName);

      if (mappedContainer) {
        acc[service.name] = mappedContainer;
      }

      return acc;
    },
    {},
  );

  const service: ServiceEntry = {
    name: serviceConfig.name,
    containers: { ...mappedServices, ...sidecarContainers },
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
    if (
      serviceFilter?.length > 0 &&
      !serviceFilter.includes(serviceConfig.name)
    ) {
      return acc;
    }

    if (!serviceConfig.deploy) {
      return acc;
    }

    const mappedService = mapService(serviceConfig, {
      serviceMap,
      ...additionalInput,
    });

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
