// node --import ./scripts/register-ts.mjs <file.ts>  — run app TypeScript (lib/, scripts/) with plain Node
import { register } from "node:module";

register("./ts-hooks.mjs", import.meta.url);
