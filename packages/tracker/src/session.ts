/**
 * ClickPulse: Ephemeral Session Management
 *
 * Implements a privacy-friendly, zero-cookie session ID stored exclusively in sessionStorage.
 * Automatically rotates session IDs on 30 minutes of user inactivity or tab close.
 */

const SESSION_STORAGE_KEY = "_cp_sid";
const ACTIVITY_STORAGE_KEY = "_cp_act";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface SessionInfo {
  sessionId: string;
  isNewSession: boolean;
}

export function getOrCreateSessionId(timeoutMs: number = DEFAULT_TIMEOUT_MS): SessionInfo {
  const now = Date.now();
  let isNewSession = false;

  try {
    const existingSession = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    const lastActiveStr = window.sessionStorage.getItem(ACTIVITY_STORAGE_KEY);
    const lastActive = lastActiveStr ? parseInt(lastActiveStr, 10) : 0;

    // Check if session exists and is still active within timeout window
    if (existingSession && lastActive && now - lastActive <= timeoutMs) {
      window.sessionStorage.setItem(ACTIVITY_STORAGE_KEY, now.toString());
      return { sessionId: existingSession, isNewSession: false };
    }

    // Otherwise, generate a fresh session ID
    isNewSession = true;
    const newSessionId = generateUUID();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, newSessionId);
    window.sessionStorage.setItem(ACTIVITY_STORAGE_KEY, now.toString());
    return { sessionId: newSessionId, isNewSession: true };
  } catch {
    // Fallback if sessionStorage is disabled or blocked
    return { sessionId: generateUUID(), isNewSession: true };
  }
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
