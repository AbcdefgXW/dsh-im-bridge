/**
 * Weixin protocol types (mirrors proto: GetUpdatesReq/Resp, WeixinMessage, SendMessageReq).
 * API uses JSON over HTTP; bytes fields are base64 strings in JSON.
 */
/** proto: UploadMediaType */
export const UploadMediaType = {
    IMAGE: 1,
    VIDEO: 2,
    FILE: 3,
    VOICE: 4,
};
export const MessageType = {
    NONE: 0,
    USER: 1,
    BOT: 2,
};
export const MessageItemType = {
    NONE: 0,
    TEXT: 1,
    IMAGE: 2,
    VOICE: 3,
    FILE: 4,
    VIDEO: 5,
    TOOL_CALL_START: 11,
    TOOL_CALL_RESULT: 12,
};
export const MessageState = {
    NEW: 0,
    GENERATING: 1,
    FINISH: 2,
};
/** Typing status: 1 = typing (default), 2 = cancel typing. */
export const TypingStatus = {
    TYPING: 1,
    CANCEL: 2,
};
