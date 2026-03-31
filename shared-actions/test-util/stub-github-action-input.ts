import { vi } from "vitest";

export function stubGithubActionInput(inputName: string, value: string) {
  vi.stubEnv(`INPUT_${inputName.toUpperCase()}`, value);
}
