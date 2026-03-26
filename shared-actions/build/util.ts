import * as core from "@actions/core";
import fs from 'fs';

// Taken from https://github.com/docker/actions-toolkit/blob/7f3ea34932528f872ce4d1787cab7f5ab94b2491/src/buildx/build.ts#L384
function parseSecretKvp(kvp: string, redact?: boolean): [string, string] {
  const delimiterIndex = kvp.indexOf("=");
  const key = kvp.substring(0, delimiterIndex);
  const value = kvp.substring(delimiterIndex + 1);
  if (key.length == 0 || value.length == 0) {
    throw new Error(`${kvp} is not a valid secret`);
  }
  if (redact) {
    core.setSecret(value);
  }
  return [key, value];
}

// Taken from https://github.com/docker/actions-toolkit/blob/7f3ea34932528f872ce4d1787cab7f5ab94b2491/src/buildx/build.ts#L206
export function resolveSecretEnv(kvp: string): string {
  const [key, value] = parseSecretKvp(kvp);
  return `id=${key},env=${value}`;
}

export interface ResolveSecretsOpts {
  asFile?: boolean;
  redact?: boolean;
}

// Adapted from https://github.com/docker/actions-toolkit/blob/7f3ea34932528f872ce4d1787cab7f5ab94b2491/src/buildx/build.ts#L199
export function resolveSecretFile(kvp: string): string {
    const [key, file] = parseSecretKvp(kvp);

      if (!fs.existsSync(file)) {
        throw new Error(`secret file ${file} not found`);
    }
    return `id=${key},src=${file}`;
  }
