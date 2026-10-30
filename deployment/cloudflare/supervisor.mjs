import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

async function requireExistingAdmin() {
	const require = createRequire("/app/apps/worker/package.json");
	const { Pool } = require("pg");
	const pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		max: 1,
		connectionTimeoutMillis: 5000,
		query_timeout: 5000,
	});
	try {
		const { rows } = await pool.query("SELECT EXISTS (SELECT 1 FROM \"user\" WHERE role = 'admin') AS ready");
		if (!rows[0]?.ready) throw new Error("Missing administrator");
	} catch {
		throw new Error(
			"Cloudflare startup requires a reachable, migrated database with an existing administrator. Bootstrap it privately before deployment.",
		);
	} finally {
		await pool.end();
	}
}

/** Keep the existing web and pg-boss processes in one container lifecycle. */
export async function startSupervisor({
	webCommand = [process.execPath, "/app/apps/web/.output/server/index.mjs"],
	workerCommand = [process.execPath, "--import", "tsx", "/app/apps/worker/src/index.ts"],
	webCwd = "/app/apps/web",
	workerCwd = "/app/apps/worker",
	healthPort = 3001,
	webPort = 3000,
	shutdownTimeout = 35_000,
	forwardLogs = true,
	checkBootstrap = requireExistingAdmin,
} = {}) {
	await checkBootstrap();
	let stopping = false;
	let workerReady = false;
	let workerOutput = "";
	let resolveStopped;
	const stopped = new Promise((resolve) => {
		resolveStopped = resolve;
	});
	const web = spawn(webCommand[0], webCommand.slice(1), {
		cwd: webCwd,
		env: { ...process.env, HOST: "0.0.0.0", PORT: String(webPort) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const worker = spawn(workerCommand[0], workerCommand.slice(1), {
		cwd: workerCwd,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const children = [web, worker];
	for (const child of children) {
		if (forwardLogs) {
			child.stdout.pipe(process.stdout);
			child.stderr.pipe(process.stderr);
		}
	}
	worker.stdout.on("data", (chunk) => {
		workerOutput = (workerOutput + chunk.toString()).slice(-4096);
		if (workerOutput.includes("All handlers registered, worker is ready")) workerReady = true;
	});
	const server = createServer(async (request, response) => {
		response.setHeader("Cache-Control", "no-store");
		if (request.url !== "/__container/health" || request.method !== "GET") {
			response.writeHead(404).end();
			return;
		}
		let healthy =
			!stopping && workerReady && children.every((child) => child.exitCode === null && child.signalCode === null);
		if (healthy) {
			try {
				const result = await fetch(`http://127.0.0.1:${webPort}/auth/login`, {
					signal: AbortSignal.timeout(4000),
					redirect: "manual",
				});
				healthy = result.status >= 200 && result.status < 400;
				await result.body?.cancel();
			} catch {
				healthy = false;
			}
		}
		response.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ ready: healthy }));
	});
	let stoppingPromise;
	function stop(exitCode = 0) {
		stoppingPromise ??= (async () => {
			stopping = true;
			workerReady = false;
			server.close();
			server.closeAllConnections();
			await Promise.all(
				children.map(
					(child) =>
						new Promise((resolve) => {
							if (child.exitCode !== null || child.signalCode !== null) {
								resolve();
								return;
							}
							const finish = () => {
								child.stdout.destroy();
								child.stderr.destroy();
								resolve();
							};
							const timer = setTimeout(() => {
								child.kill("SIGKILL");
								finish();
							}, shutdownTimeout);
							child.once("exit", () => {
								clearTimeout(timer);
								finish();
							});
							child.kill("SIGTERM");
						}),
				),
			);
			resolveStopped(exitCode);
		})();
		return stoppingPromise;
	}
	for (const child of children) {
		child.once("error", () => {
			void stop(1);
		});
		child.once("exit", () => {
			if (!stopping) void stop(1);
		});
	}
	try {
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(healthPort, "0.0.0.0", resolve);
		});
	} catch (error) {
		await stop(1);
		throw error;
	}
	return { web, worker, stop, stopped, healthPort: server.address()?.port };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const supervisor = await startSupervisor();
	for (const signal of ["SIGTERM", "SIGINT"])
		process.on(signal, () => {
			void supervisor.stop();
		});
	process.exitCode = await supervisor.stopped;
}
