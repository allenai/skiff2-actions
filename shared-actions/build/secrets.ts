import * as core from "@actions/core";
import fs from "fs";
import path, { dirname } from "path";
import os from "os";
import { tmpNameSync, type TmpNameOptions } from "tmp";
import { fileURLToPath } from "url";

// Taken from https://github.com/docker/actions-toolkit/blob/7f3ea34932528f872ce4d1787cab7f5ab94b2491/src/context.ts#L22
export class TempFileContext {
  private static readonly _tmpDir = fs.mkdtempSync(
    path.join(
      TempFileContext.ensureDirExists(process.env.RUNNER_TEMP || os.tmpdir()),
      "docker-actions-toolkit-",
    ),
  );

  private static ensureDirExists(dir: string): string {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  public static tmpDir(): string {
    return TempFileContext._tmpDir;
  }

  public static tmpName(options?: TmpNameOptions): string {
    return tmpNameSync(options);
  }
}

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

export interface ResolveSecretsOpts {
  asFile?: boolean;
  redact?: boolean;
}

// Adapted from https://github.com/docker/actions-toolkit/blob/7f3ea34932528f872ce4d1787cab7f5ab94b2491/src/buildx/build.ts#L211
function resolveSecret(
  kvp: string,
  opts?: ResolveSecretsOpts,
): [string, string] {
  const [key, value] = parseSecretKvp(kvp, opts?.redact);
  if (opts?.asFile) {
    if (!fs.existsSync(value)) {
      throw new Error(`secret file ${value} not found`);
    }
    return [key, value];
  }
  const secretFile = TempFileContext.tmpName({
    tmpdir: TempFileContext.tmpDir(),
  });
  fs.writeFileSync(secretFile, value);
  return [key, secretFile];
}

// Adapted from https://github.com/docker/actions-toolkit/blob/7f3ea34932528f872ce4d1787cab7f5ab94b2491/src/buildx/build.ts#L192
export function resolveSecretString(kvp: string): string {
  const [key, file] = resolveSecret(kvp, {
    redact: true,
  });
  return `id=${key},src=${file}`;
}

// Adapted from https://github.com/docker/actions-toolkit/blob/7f3ea34932528f872ce4d1787cab7f5ab94b2491/src/buildx/build.ts#L199
export function resolveSecretFile(kvp: string): string {
  const [key, file] = resolveSecret(kvp, {
    asFile: true,
  });
  return `id=${key},src=${file}`;
}

// Adapted from https://github.com/docker/actions-toolkit/blob/7f3ea34932528f872ce4d1787cab7f5ab94b2491/src/buildx/build.ts#L206
export function resolveSecretEnv(kvp: string): string {
  const [key, value] = parseSecretKvp(kvp);
  return `id=${key},env=${value}`;
}
