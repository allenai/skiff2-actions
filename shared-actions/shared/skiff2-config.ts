import { z } from "zod";

export const ContainerMachineConfigSchema = z.strictObject({
  memory: z.string().optional().default("512Mi"),
  cpu: z.int().min(1).optional().default(1),
  cpuIdle: z.boolean().optional().default(true),
});

export const MachineConfigSchema = z.strictObject({
  ...ContainerMachineConfigSchema.shape,
  minInstances: z.int().min(0).optional().default(1),
  maxInstances: z.int().min(1).optional().default(10),
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
});

const ContainerConfigSchema = z.strictObject({
  name: z.string().min(1, "Name is required"),
  cwd: z.string().min(1, "cwd is required"),
  dockerFile: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  extraBuildArgs: z.array(z.string()).optional(),
  allowUnauthenticated: z.boolean().optional().default(false),
  allowDelete: z.boolean().optional(),
  secretFiles: z.record(z.string(), z.string()).optional().default({}),
  machine: ContainerMachineConfigSchema.optional().prefault({}),
  startup: ProbeConfigSchema.optional(),
  liveness: ProbeConfigSchema.optional(),
  vpc: VpcSchema.optional(),
});
export type ContainerConfig = z.infer<typeof ContainerConfigSchema>;

export const ServiceConfigSchema = z.strictObject({
  ...ContainerConfigSchema.shape,
  deploy: z.boolean().optional().default(true),
  isRootService: z.boolean().optional(),
  secondaryImage: z
    .string()
    .optional()
    .meta({
      deprecated: true,
      description:
        "To add another container to this service use sidecars instead.",
    }),
  sidecars: z.array(ContainerConfigSchema).optional(),
  allowUnauthenticated: z.boolean().optional().default(false),
  allowDelete: z.boolean().optional().default(false),
  customDomains: z.array(z.string()).optional().default([]),
  machine: MachineConfigSchema.optional().prefault({}),
  httpVersion: z
    .union([z.literal("1"), z.literal("2")])
    .default("1")
    .meta({
      description:
        "Defines the HTTP version to use for this service. Only use HTTP2 if your service supports HTTP2. https://docs.cloud.google.com/run/docs/configuring/http2",
    }),
});

export const BuildConfigSchema = z.strictObject({
  projectName: z.string().min(1).optional(),
  environments: z.array(z.string().min(1)).optional(),
  services: z
    .array(ServiceConfigSchema)
    .min(1, "At least one service is required"),
  $schema: z.url().optional(),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type BuildConfig = z.infer<typeof BuildConfigSchema>;
