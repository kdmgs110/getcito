import assert from "node:assert/strict";
import { test } from "node:test";
import { ALARM_INTERVAL_MS, ContainerLifecycle, HEALTH_PORT, INACTIVITY_TIMEOUT_MS } from "./lifecycle.ts";

const bindings = {
	CONTAINER_ENABLED: "true",
	APP_URL: "https://getcito.example.org",
	DATABASE_URL: "postgresql://user:password@db.example.org/getcito",
	BETTER_AUTH_SECRET: "a".repeat(32),
};
function fixture(
	options: {
		enabled?: boolean;
		initiallyRunning?: boolean;
		healthy?: boolean;
		ignoreTerm?: boolean;
		destroyFails?: boolean;
	} = {},
) {
	let alarm: number | null = null;
	let time = 1_000_000;
	let starts = 0;
	let probes = 0;
	let destroys = 0;
	const timeouts: (number | bigint)[] = [];
	const signals: number[] = [];
	const container = {
		running: options.initiallyRunning ?? false,
		start() {
			starts++;
			this.running = true;
		},
		async setInactivityTimeout(value: number | bigint) {
			timeouts.push(value);
		},
		getTcpPort(port: number) {
			assert.equal(port, HEALTH_PORT);
			return {
				fetch: async () => {
					probes++;
					return new Response(null, { status: options.healthy === false ? 503 : 200 });
				},
			} as unknown as Fetcher;
		},
		signal(value: number) {
			signals.push(value);
			if (!options.ignoreTerm) this.running = false;
		},
		async destroy() {
			destroys++;
			if (!options.destroyFails) this.running = false;
		},
		monitor: () => (options.ignoreTerm ? new Promise<void>(() => {}) : Promise.resolve()),
	};
	const storage = {
		getAlarm: async () => alarm,
		setAlarm: async (value: number) => {
			alarm = value;
		},
		deleteAlarm: async () => {
			alarm = null;
		},
	};
	const lifecycle = new ContainerLifecycle(
		container,
		storage,
		{ ...bindings, CONTAINER_ENABLED: options.enabled === false ? "false" : "true" },
		async (ms) => {
			time += ms;
		},
		() => time,
	);
	return {
		container,
		storage,
		lifecycle,
		signals,
		timeouts,
		get alarm() {
			return alarm;
		},
		get starts() {
			return starts;
		},
		get destroys() {
			return destroys;
		},
		get probes() {
			return probes;
		},
		get time() {
			return time;
		},
	};
}
test("concurrent cold requests start one container and share readiness", async () => {
	const f = fixture();
	await Promise.all([f.lifecycle.ensureReady(), f.lifecycle.ensureReady(), f.lifecycle.ensureReady()]);
	assert.equal(f.starts, 1);
	assert.equal(f.probes, 1);
	assert.equal(f.alarm, f.time + ALARM_INTERVAL_MS);
	assert.ok(f.timeouts.includes(INACTIVITY_TIMEOUT_MS));
});
test("restore protects an existing long job and alarms recover an exited process", async () => {
	const f = fixture({ initiallyRunning: true });
	await f.lifecycle.restore();
	assert.equal(f.starts, 0);
	assert.deepEqual(f.timeouts, [INACTIVITY_TIMEOUT_MS]);
	f.container.running = false;
	await f.lifecycle.alarm();
	assert.equal(f.starts, 1);
	assert.notEqual(f.alarm, null);
});
test("failed readiness keeps a future retry instead of stranding the background worker", async () => {
	const f = fixture({ healthy: false });
	await assert.rejects(f.lifecycle.alarm(), /not ready/);
	assert.equal(f.starts, 1);
	assert.equal(f.probes, 90);
	assert.notEqual(f.alarm, null);
});
test("disabled deployment cancels alarms and gracefully stops without waking again", async () => {
	const f = fixture({ enabled: false, initiallyRunning: true });
	await f.lifecycle.alarm();
	assert.equal(f.starts, 0);
	assert.deepEqual(f.signals, [15]);
	assert.equal(f.alarm, null);
	await assert.rejects(f.lifecycle.ensureReady(), /disabled/);
	assert.equal(f.starts, 0);
});

test("concurrent stops share one signal and force-stop an unresponsive container after the deadline", async () => {
	const f = fixture({ enabled: false, initiallyRunning: true, ignoreTerm: true });
	await Promise.all([f.lifecycle.stop(), f.lifecycle.stop(), f.lifecycle.stop()]);
	assert.deepEqual(f.signals, [15]);
	assert.equal(f.destroys, 1);
	assert.equal(f.container.running, false);
	assert.equal(f.alarm, null);
});
test("a failed force-stop is surfaced instead of claiming billing has stopped", async () => {
	const f = fixture({ enabled: false, initiallyRunning: true, ignoreTerm: true, destroyFails: true });
	await assert.rejects(f.lifecycle.stop(), /did not stop/);
	assert.equal(f.container.running, true);
});
