import { generateInfraTFVars } from "./generate-infra-tfvars.ts";
import * as core from "@actions/core";

generateInfraTFVars().catch((error) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else {
    core.setFailed("Unknown error occurred");
  }
});
