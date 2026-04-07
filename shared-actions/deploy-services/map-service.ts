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



export function mapContainer(serviceConfig: ServiceConfig, repoName: string): Container | undefined {
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
  containers: Record<string, Container> 
  
  image_tag: string;
  allow_unauthenticated: boolean;
  allow_delete: boolean;
  min_instances: number;
  max_instances: number;
}

export function mapService(serviceConfig: ServiceConfig, repoName: string, serviceMap: Map<string, ServiceConfig>, imageTag: string): ServiceEntry | undefined {
    const sidecarServices = new Map([...serviceMap].filter(([key, value]) => serviceConfig.additionalContainers?.includes(key)));
    if (serviceConfig.additionalContainers && [...sidecarServices.keys()].length !== serviceConfig.additionalContainers?.length) {
        throw new Error(`Service config for additional container not found. Service: ${serviceConfig.name}, Additional containers: ${serviceConfig.additionalContainers}`)
    }

    const allConfigsForService = [serviceConfig, ...sidecarServices.values()];
    const containers = allConfigsForService.reduce((acc, service) => {
        const mappedContainer = mapContainer(service, repoName);
        
        if (mappedContainer) {
            acc[service.name] = mappedContainer
        }

        return acc
    }, {} as Record<string, Container>)
    
    const service: ServiceEntry = {
        name: serviceConfig.name,
        containers,
        image_tag: imageTag,
        allow_unauthenticated: serviceConfig.allowUnauthenticated,
        allow_delete: serviceConfig.allowDelete,
        min_instances: serviceConfig.machine.minInstances,
        max_instances: serviceConfig.machine.maxInstances
    } 
    
    return service
}
