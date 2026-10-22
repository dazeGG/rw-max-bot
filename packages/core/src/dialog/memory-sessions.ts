import type { Session, SessionStore } from './types';

export class MemorySessionStore implements SessionStore {
	private readonly sessions = new Map<number, Session>();

	async get (userId: number): Promise<Session> {
		return this.sessions.get(userId) ?? { nodeId: null };
	}

	async set (userId: number, session: Session): Promise<void> {
		this.sessions.set(userId, session);
	}
}
