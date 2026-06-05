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
  ephemeral_storage: Record<string, string>;
  nfs_volumes: Record<
    string,
    { server: string; path: string; read_only: boolean }
  >;

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

  startup?: ProbeConfig;
  liveness?: ProbeConfig;
  
  depends_on: string[];
}

function baseMapToContainer(
  config: ServiceConfig | ContainerConfig,
  repoName: string,
): Container {
  const startup = config.startup != null ? {
      initial_delay_seconds: config.startup.initialDelaySeconds,
      timeout_seconds: config.startup.timeoutSeconds,
      period_seconds: config.startup.periodSeconds,
      failure_threshold: config.startup.failureThreshold,
      path: config.startup.path,
      port: config.startup.port,
    } : undefined;

    const liveness = config.liveness != null ? {
      initial_delay_seconds: config.liveness.initialDelaySeconds,
      timeout_seconds: config.liveness.timeoutSeconds,
      period_seconds: config.liveness.periodSeconds,
      failure_threshold: config.liveness.failureThreshold,
      path: config.liveness.path,
      port: config.liveness.port,
    } : undefined;
    
  const container: Container = {
    name: config.name,
    container_name: `${repoName}-${config.name}`,
    secret_files: config.secretFiles,
    ephemeral_storage: config.ephemeralStorage,
    nfs_volumes: Object.fromEntries(
      Object.entries(config.nfsVolumes).map(([mountPath, nfs]) => [
        mountPath,
        { server: nfs.server, path: nfs.path, read_only: nfs.readOnly },
      ]),
    ),
    machine: {
      memory: config.machine.memory,
      cpu: String(config.machine.cpu),
      cpu_idle: config.machine.cpuIdle,
    },
    startup,
    liveness,
    depends_on: config.runtimeDependsOn
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
  containers: Container[];

  image_tag: string;
  allow_unauthenticated: boolean;
  allowed_principals: string[];
  allow_delete: boolean;
  min_instances: number;
  max_instances: number;
  
  service_account?: string;
}

interface MapServiceAdditionalInput {
  serviceMap: Map<string, ServiceConfig>;
  repoName: string;
  imageTag: string;
  isProdBranch: boolean;
  isLongLived: boolean;
  deploymentEnv: string;
}

function mapService(
  serviceConfig: ServiceConfig,
  { serviceMap, repoName, imageTag, isLongLived }: MapServiceAdditionalInput,
): ServiceEntry | undefined {
  const sidecarContainers =
    serviceConfig.sidecars?.map((sidecar) =>
      mapSidecarToContainer(sidecar, repoName),
    ) ?? [];

  const secondaryImageContainer = serviceConfig.secondaryImage
    ? serviceMap.get(serviceConfig.secondaryImage)
    : null;
  if (serviceConfig.secondaryImage && secondaryImageContainer == null) {
    throw new Error(
      `Service config for secondary image not found. Service: ${serviceConfig.name}, Missing service: ${serviceConfig.secondaryImage})}`,
    );
  }

  // The root service's container MUST be the first container
  // TF or Cloud Run automatically add ports to that container if it doesn't already have some
  // Since only one container can have ports in a service, having the root service not be first will cause problems with that
  const allConfigsForService = [
    serviceConfig,
    ...(secondaryImageContainer ? [secondaryImageContainer] : []),
  ];
  const mappedServices = allConfigsForService.flatMap((service) => {
    const mappedContainer = mapServiceToContainer(service, repoName);

    if (mappedContainer) {
      return [mappedContainer];
    }

    return [];
  });

  const service: ServiceEntry = {
    name: serviceConfig.name,
    containers: [...mappedServices, ...sidecarContainers],
    image_tag: imageTag,
    allow_unauthenticated: serviceConfig.allowUnauthenticated,
    allowed_principals: serviceConfig.allowedPrincipals,
    allow_delete: isLongLived
      ? (serviceConfig.allowDelete ?? false)  // prod/long-lived: protected unless explicitly true
      : (serviceConfig.allowDelete ?? true),  // ephemeral: deletable unless explicitly false
    min_instances: serviceConfig.machine.minInstances,
    max_instances: serviceConfig.machine.maxInstances,
    service_account: serviceConfig.serviceAccount,
  };

  return service;
}

export function mapServices(
  services: ServiceConfig[],
  additionalInput: Omit<MapServiceAdditionalInput, "serviceMap">,
): Record<string, ServiceEntry> {
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
    if (!serviceConfig.deploy) {
      return acc;
    }

    const mappedService = mapService(serviceConfig, {
      serviceMap,
      ...additionalInput,
    });

    const serviceKey = additionalInput.isProdBranch
      ? serviceConfig.name
      : `${additionalInput.deploymentEnv}-${serviceConfig.name}`;

    if (mappedService) {
      acc[serviceKey] = mappedService;
    }

    return acc;
  }, {});

  return mappedServices;
}
