import path from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve the OpenClaw state directory (mirrors core logic in src/infra). */
export function resolveStateDir(): string {
  return (
    process.env.DSH_CHANNELS_STATE_DIR?.trim() ||
    path.join(fileURLToPath(new URL("../../../../", import.meta.url)), "state")
  );
}
