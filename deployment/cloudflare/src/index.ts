import { DurableObject } from "cloudflare:workers";
import { blockedPublicPath, canonicalOrigin, forwardRequest, type RuntimeBindings } from "./environment.ts";
import { ContainerLifecycle, WEB_PORT } from "./lifecycle.ts";

const SINGLETON_NAME = "getcito-primary";
export interface Env extends RuntimeBindings {
	GETCITO_CONTAINER: DurableObjectNamespace<GetCitoContainer>;
}
function unavailable() {
	return new Response("GetCito is temporarily unavailable. Please retry shortly.", {
		status: 503,
		headers: { "Retry-After": "30", "Cache-Control": "no-store" },
	});
}
export class GetCitoContainer extends DurableObject<Env> {
	private readonly lifecycle: ContainerLifecycle;
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		if (!ctx.container) throw new Error("Container binding is required");
		this.lifecycle = new ContainerLifecycle(ctx.container, ctx.storage, env, (ms) => scheduler.wait(ms));
		if (env.CONTAINER_ENABLED === "true") void ctx.blockConcurrencyWhile(() => this.lifecycle.restore());
		else ctx.waitUntil(this.lifecycle.stop());
	}
	async keepAlive(): Promise<void> {
		if (this.env.CONTAINER_ENABLED !== "true") return this.lifecycle.stop();
		await this.lifecycle.ensureReady();
	}
	async alarm(): Promise<void> {
		try {
			await this.lifecycle.alarm();
		} catch {
			console.error("GetCito container readiness failed; next wake-up is scheduled.");
		}
	}
	async fetch(request: Request): Promise<Response> {
		try {
			await this.lifecycle.ensureReady();
			const container = this.ctx.container;
			if (!container) return unavailable();
			return await container.getTcpPort(WEB_PORT).fetch(forwardRequest(request, canonicalOrigin(this.env)));
		} catch {
			// Never include database credentials or OAuth errors in proxy responses.
			console.error("GetCito container request could not be served.");
			return unavailable();
		}
	}
}
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (env.CONTAINER_ENABLED !== "true") return unavailable();
		let origin: URL;
		try {
			origin = canonicalOrigin(env);
		} catch {
			return unavailable();
		}
		const url = new URL(request.url);
		if (url.origin !== origin.origin) return new Response("Unknown host", { status: 421 });
		if (blockedPublicPath(url.pathname))
			return new Response("This route is not available on this deployment.", {
				status: 403,
				headers: { "Cache-Control": "no-store" },
			});
		return env.GETCITO_CONTAINER.getByName(SINGLETON_NAME).fetch(request);
	},
	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		try {
			await env.GETCITO_CONTAINER.getByName(SINGLETON_NAME).keepAlive();
		} catch {
			console.error("GetCito scheduled wake-up failed; the next Cron Trigger will retry.");
		}
	},
} satisfies ExportedHandler<Env>;
