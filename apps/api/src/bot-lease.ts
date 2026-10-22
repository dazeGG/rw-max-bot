// Два запущенных бота забирают одни и те же сообщения из MAX и отвечают дважды.
// Работает тот экземпляр, который держит аренду: он продлевает ее чаще, чем она истекает,
// а другой получает отказ и завершается. Аренда живет в памяти API: после перезапуска API
// ее заново получает первый продливший бот, второй получит отказ при следующем продлении.
export class BotLease {
	private holder: { instanceId: string; expiresAt: number; } | null = null;

	constructor (
		private readonly ttlMs: number,
		private readonly now: () => number = Date.now,
	) {}

	acquire (instanceId: string): boolean {
		const now = this.now();

		if (this.holder && this.holder.instanceId !== instanceId && this.holder.expiresAt > now) {
			return false;
		}

		this.holder = { instanceId, expiresAt: now + this.ttlMs };
		return true;
	}

	release (instanceId: string): void {
		if (this.holder?.instanceId === instanceId) {
			this.holder = null;
		}
	}
}
