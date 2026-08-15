import path from "node:path";
/** Resolve the OpenClaw state directory (mirrors core logic in src/infra). */
export function resolveStateDir() {
    return (process.env.DSH_CHANNELS_STATE_DIR?.trim() ||
        path.join("/workspace", "dsh-plugins", "dsh-im-bridge", "state"));
}
