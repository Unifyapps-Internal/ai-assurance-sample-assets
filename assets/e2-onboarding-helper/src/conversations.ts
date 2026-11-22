import type { Message } from './model.js';

interface Conversation {
  messages: Message[];
  updatedAt: number;
}

const DAY_MS = 86_400_000;
const HISTORY_LIMIT = 10;

/** Conversations kept in memory, keyed by session id. */
export class Conversations {
  private readonly sessions = new Map<string, Conversation>();

  history(sessionId: string): Message[] {
    return (this.sessions.get(sessionId)?.messages ?? []).slice(-HISTORY_LIMIT);
  }

  append(sessionId: string, question: string, answer: string, now: number): void {
    const conversation = this.sessions.get(sessionId) ?? { messages: [], updatedAt: now };
    conversation.messages.push({ role: 'user', text: question }, { role: 'model', text: answer, toolCalls: [] });
    conversation.updatedAt = now;
    this.sessions.set(sessionId, conversation);
  }

  /** Drops conversations idle for longer than the retention period; null keeps everything. */
  purge(retentionDays: number | null, now: number): void {
    if (retentionDays === null) return;
    for (const [id, conversation] of this.sessions) {
      if (now - conversation.updatedAt > retentionDays * DAY_MS) this.sessions.delete(id);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
