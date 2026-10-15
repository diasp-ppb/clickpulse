/**
 * ClickPulse: Ephemeral Session Management
 *
 * Implements a privacy-friendly, zero-cookie session ID stored exclusively in sessionStorage.
 * Automatically rotates session IDs on 30 minutes of user inactivity or tab close.
 */

const KEY_SID = "_cp_sid";
const KEY_ACT = "_cp_act";
const DEFAULT_TIMEOUT_MS = 18e5; // 30 minutes

export interface SessionInfo {
  sessionId: string;
  isNewSession: boolean;
}

let memSid: string | undefined;

export function getOrCreateSessionId(timeoutMs = 18e5): SessionInfo {
  try {
    const s = sessionStorage;
    const now = Date.now();
    const lastActive = +(s.getItem(KEY_ACT) || 0);
    const sid = s.getItem(KEY_SID);
    const isExisting = Boolean(sid && lastActive && now - lastActive <= timeoutMs);
    const sessionId = isExisting ? (sid as string) : generateUUID();
    s.setItem(KEY_SID, sessionId);
    s.setItem(KEY_ACT, `${now}`);
    return { sessionId, isNewSession: !isExisting };
  } catch {
    const isNewSession = !memSid;
    return { sessionId: (memSid ||= generateUUID()), isNewSession };
  }
}

function generateUUID(): string {
  return (
    globalThis.crypto?.randomUUID?.() ||
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ ((Math.random() * 16) >> (+c / 4))).toString(16)
    )
  );
}

