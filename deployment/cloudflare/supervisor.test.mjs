import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { startSupervisor } from "./supervisor.mjs";

async function availablePort() {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const port = server.address().port;
	await new Promise((resolve) => server.close(resolve));
	return port;
}

async function fixture(workerScript, options = {}) {
	const webPort = await availablePort();
	return startSupervisor({
		webCommand: [
			process.execPath,
			"-e",
			`require('http').createServer((req,res)=>res.end('login')).listen(${webPort},'127.0.0.1')`,
		],
		workerCommand: [process.execPath, "-e", workerScript],
		webCwd: process.cwd(),
		workerCwd: process.cwd(),
		webPort,
		healthPort: 0,
		shutdownTimeout: 2000,
		forwardLogs: false,
		checkBootstrap: async () => {},
		...options,
	});
}

test("readiness waits for registered job handlers and shutdown drains both children", async () => {
	const instance = await fixture(
		"setTimeout(()=>console.log('All handlers registered, worker is ready'),500);setInterval(()=>{},1000)",
	);
	try {
		const endpoint = `http://127.0.0.1:${instance.healthPort}/__container/health`;
		assert.equal((await fetch(endpoint)).status, 503);
		await once(instance.worker.stdout, "data");
		const ready = await fetch(endpoint);
		assert.equal(ready.status, 200);
		assert.deepEqual(await ready.json(), { ready: true });
		assert.equal((await fetch(`http://127.0.0.1:${instance.healthPort}/other`)).status, 404);
	} finally {
		await instance.stop();
	}
	assert.equal(await instance.stopped, 0);
	assert.ok(instance.web.signalCode || instance.web.exitCode !== null);
	assert.ok(instance.worker.signalCode || instance.worker.exitCode !== null);
});

test("a failed job process stops the web process so an unhealthy container can restart", async () => {
	const instance = await fixture("setInterval(()=>{},1000)");
	instance.worker.kill("SIGKILL");
	assert.equal(await instance.stopped, 1);
	assert.ok(instance.web.signalCode || instance.web.exitCode !== null);
});

test("shutdown has a deadline when a worker ignores SIGTERM", { timeout: 3000 }, async () => {
	const instance = await fixture("process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)", {
		shutdownTimeout: 100,
	});
	await once(instance.worker.stdout, "data");
	await instance.stop();
	if (instance.worker.signalCode === null && instance.worker.exitCode === null) await once(instance.worker, "exit");
	assert.equal(instance.worker.signalCode, "SIGKILL");
	assert.equal(await instance.stopped, 0);
});
