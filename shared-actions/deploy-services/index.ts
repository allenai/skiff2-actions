import { generateServicesTFVars } from "./generate-services-tfvars.ts";
import * as core from "@actions/core";

generateServicesTFVars().catch((error) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else {
    core.setFailed("Unknown error occurred");
  }
});
