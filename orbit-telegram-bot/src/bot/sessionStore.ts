import type { SessionData } from "./session.js";

const store = new Map<number, SessionData>();

export function getSession(telegramId: number): SessionData | undefined {
  return store.get(telegramId);
}

export function setSession(telegramId: number, data: SessionData): void {
  store.set(telegramId, data);
}
