import type { ServiceConfig } from "./skiff2-config.ts";

export function sanitizeBranchTag(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function computeAllowDelete(service: ServiceConfig, isLongLived: boolean): boolean {
  return isLongLived
    ? (service.allowDelete ?? false)    // prod/long-lived: protected unless explicitly true
    : (service.allowDelete ?? true);    // ephemeral: deletable unless explicitly false
}
