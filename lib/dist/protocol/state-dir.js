import path from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Resolve the dsh-msg-hub state directory.
 * Default: /workspace/dsh-plugins/dsh-msg-hub/state (override via DSH_CHANNELS_STATE_DIR).
 */
export function resolveStateDir() {
    return (process.env.DSH_CHANNELS_STATE_DIR?.trim() ||
        path.join(fileURLToPath(new URL("../../../", import.meta.url)), "state"));
}
