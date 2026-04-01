export function sanitizeBranchTag(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]/g, "-");
}
