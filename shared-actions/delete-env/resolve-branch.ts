import * as core from "@actions/core";
import { sanitizeBranchTag } from "../shared/utils.ts";

const branch = core.getInput("branch", { required: true });
core.setOutput("workspace", sanitizeBranchTag(branch));
