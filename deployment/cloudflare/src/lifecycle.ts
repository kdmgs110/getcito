import { type RuntimeBindings, runtimeEnvironment } from "./environment.ts";

export const WEB_PORT = 3000;
export const HEALTH_PORT = 3001;
export const HEALTH_PATH = "/__container/health";
export const ALARM_INTERVAL_MS = 60_000;
// The maximum supported timeout protects long jobs if an individual wake-up is
// delayed. Alarms and Cron Triggers renew it while the deployment is enabled.
export const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000;

type ManagedContainer = Pick<
	Container,
	"running" | "start" | "setInactivityTimeout" | "getTcpPort" | "signal" | "monitor" | "destroy"
>;
interface AlarmStorage {
	getAlarm(): Promise<number | null>;
	setAlarm(timestamp: number): Promise<void>;
	deleteAlarm(): Promise<void>;
}
export class ContainerLifecycle {
	private starting?: Promise<void>;
	private stopping?: Promise<void>;
	private lastReadyAt = 0;
	private readonly container: ManagedContainer;
	private readonly storage: AlarmStorage;
	private readonly bindings: RuntimeBindings;
	private readonly wait: (milliseconds: number) => Promise<void>;
	private readonly now: () => number;
	constructor(
		container: ManagedContainer,
		storage: AlarmStorage,
		bindings: RuntimeBindings,
		wait: (milliseconds: number) => Promise<void>,
		now = Date.now,
	) {
		this.container = container;
		this.storage = storage;
		this.bindings = bindings;
		this.wait = wait;
		this.now = now;
	}
	async restore(): Promise<void> {
		if (this.bindings.CONTAINER_ENABLED !== "true") return this.stop();
		if (this.container.running) await this.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
		await this.schedule();
	}
	private async schedule(): Promise<void> {
		const next = this.now() + ALARM_INTERVAL_MS;
		const existing = await this.storage.getAlarm();
		if (existing === null || existing > next) await this.storage.setAlarm(next);
	}
	async ensureReady(): Promise<void> {
		if (this.bindings.CONTAINER_ENABLED !== "true") {
			await this.stop();
			throw new Error("Container is disabled");
		}
		// Store the next attempt before startup so failed boots are retried too.
		await this.schedule();
		if (this.container.running && this.lastReadyAt > this.now() - 5000) return;
		this.starting ??= this.startAndProbe().finally(() => {
			this.starting = undefined;
		});
		return this.starting;
	}
	private async startAndProbe(): Promise<void> {
		if (!this.container.running) {
			this.container.start({ enableInternet: true, env: runtimeEnvironment(this.bindings) });
		}
		await this.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
		const health = this.container.getTcpPort(HEALTH_PORT);
		for (let attempt = 0; attempt < 90; attempt++) {
			try {
				const response = await health.fetch(`http://container${HEALTH_PATH}`, { signal: AbortSignal.timeout(5000) });
				const ready = response.ok;
				await response.body?.cancel();
				if (ready) {
					this.lastReadyAt = this.now();
					return;
				}
			} catch {
				/* Cold starts and temporary port failures are retried. */
			}
			await this.wait(500);
		}
		throw new Error("Container services are not ready");
	}
	async alarm(): Promise<void> {
		if (this.bindings.CONTAINER_ENABLED !== "true") return this.stop();
		// A fired alarm is consumed; schedule the next one even if readiness fails.
		await this.storage.setAlarm(this.now() + ALARM_INTERVAL_MS);
		await this.ensureReady();
	}
	stop(): Promise<void> {
		this.stopping ??= this.stopOnce().finally(() => {
			this.stopping = undefined;
		});
		return this.stopping;
	}
	private async stopOnce(): Promise<void> {
		await this.storage.deleteAlarm();
		this.lastReadyAt = 0;
		if (!this.container.running) return;
		// The image supervisor forwards SIGTERM and drains pg-boss before exiting.
		this.container.signal(15);
		await Promise.race([this.container.monitor().catch(() => undefined), this.wait(40_000)]);
		if (this.container.running) await this.container.destroy("Graceful shutdown deadline exceeded");
		if (this.container.running) throw new Error("Container did not stop");
	}
}
