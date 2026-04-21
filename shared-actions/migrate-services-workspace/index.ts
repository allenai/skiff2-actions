import { main } from "./migrate-workspace.ts";
import * as core from "@actions/core";

main().catch((error) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else {
    core.setFailed("Unknown error occurred");
  }
});
