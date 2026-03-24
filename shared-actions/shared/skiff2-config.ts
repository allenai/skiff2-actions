import { z } from "zod";

export const MachineConfigSchema = z
  .object({
    minInstances: z.number().int().min(0).optional().default(1),
    maxInstances: z.number().int().min(1).optional().default(10),
    memory: z.string().optional().default('512Mi'),
    cpu: z.number().int().min(1).optional().default(1),
    cpuIdle: z.boolean().optional().default(true),
  })
  .strict()

export const ServiceConfigSchema = z
  .object({
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
    machine: MachineConfigSchema.optional().default({}),
  })
  .strict();

export const BuildConfigSchema = z
  .object({
    projectName: z.string().min(1).optional(),
    environments: z.array(z.string().min(1)).optional(),
    services: z
      .array(ServiceConfigSchema)
      .min(1, "At least one service is required"),
  })
  .strict();

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type BuildConfig = z.infer<typeof BuildConfigSchema>;
