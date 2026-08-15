import path from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Resolve the dsh-im-bridge state directory.
 * Default: /workspace/dsh-plugins/dsh-im-bridge/state (override via DSH_CHANNELS_STATE_DIR).
 */
export function resolveStateDir() {
    return (process.env.DSH_CHANNELS_STATE_DIR?.trim() ||
        path.join(fileURLToPath(new URL("../../../", import.meta.url)), "state"));
}
