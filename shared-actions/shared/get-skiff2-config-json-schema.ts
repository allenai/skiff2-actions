import path from "path";
import { BuildConfigSchema } from "./skiff2-config.ts";
import { writeFile } from "fs/promises";

const jsonSchema = JSON.stringify(
  BuildConfigSchema.toJSONSchema({ io: "input" }),
);

const filePath = path.join("skiff2-config.schema.json");
await writeFile(filePath, jsonSchema);

console.info(`JSON Schema created at ${path.resolve(filePath)}`);
