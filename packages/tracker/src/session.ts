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

export function getOrCreateSessionId(timeoutMs: number = DEFAULT_TIMEOUT_MS): SessionInfo {
  try {
    const s = sessionStorage;
    const now = Date.now();
    const lastActive = +(s.getItem(KEY_ACT) || 0);
    const sid = s.getItem(KEY_SID);

    if (sid && lastActive && now - lastActive <= timeoutMs) {
      s.setItem(KEY_ACT, `${now}`);
      return { sessionId: sid, isNewSession: false };
    }

    const newSid = generateUUID();
    s.setItem(KEY_SID, newSid);
    s.setItem(KEY_ACT, `${now}`);
    return { sessionId: newSid, isNewSession: true };
  } catch {
    if (!memSid) {
      memSid = generateUUID();
      return { sessionId: memSid, isNewSession: true };
    }
    return { sessionId: memSid, isNewSession: false };
  }
}

function generateUUID(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (+c ^ ((Math.random() * 16) >> (+c / 4))).toString(16)
      );
}

