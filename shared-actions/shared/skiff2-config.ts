import { z } from "zod";

export const MachineConfigSchema = z.strictObject({
    minInstances: z.int().min(0).optional().default(1),
    maxInstances: z.int().min(1).optional().default(10),
    memory: z.string().optional().default("512Mi"),
    cpu: z.int().min(1).optional().default(1),
    cpuIdle: z.boolean().optional().default(true),
  });

export const ProbeConfigSchema = z.object({
  initialDelaySeconds: z.number().optional(),
  timeoutSeconds: z.number().optional(),
  periodSeconds: z.number().optional(),
  failureThreshold: z.number().optional(),
  path: z.string().optional(),
  port: z.number().optional(),
});

const VpcSchema = z.strictObject({
    network: z.string(),
    subnetwork: z.string(),
    egress: z
      .enum(["PRIVATE_RANGES_ONLY", "ALL_TRAFFIC"])
      .optional()
      .default("PRIVATE_RANGES_ONLY"),
  })

export const ServiceConfigSchema = z.strictObject({
    name: z.string().min(1, "Service name is required"),
    cwd: z.string().min(1, "Service cwd is required"),
    isRootService: z.boolean().optional(),
    dockerFile: z.string().optional(),
    dependsOn: z.array(z.string()).optional(),
    deploy: z.boolean().optional(),
    secondaryImage: z.string().optional(),
    additionalContainers: z.array(z.string()).optional(),
    extraBuildArgs: z.array(z.string()).optional(),
    allowUnauthenticated: z.boolean().optional().default(false),
    allowDelete: z.boolean().optional().default(false),
    secretFiles: z.record(z.string(), z.string()).optional().default({}),
    customDomains: z.array(z.string()).optional().default([]),
    machine: MachineConfigSchema.optional().prefault({}),
    startup: ProbeConfigSchema.optional().default({}),
    liveness: ProbeConfigSchema.optional().default({}),
    vpc: VpcSchema.optional(),
  });

export const BuildConfigSchema = z.strictObject({
    projectName: z.string().min(1).optional(),
    environments: z.array(z.string().min(1)).optional(),
    services: z
      .array(ServiceConfigSchema)
      .min(1, "At least one service is required"),
    "$schema": z.url().optional()
  });

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type BuildConfig = z.infer<typeof BuildConfigSchema>;
