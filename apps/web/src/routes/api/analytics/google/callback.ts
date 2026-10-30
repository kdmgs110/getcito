import { createFileRoute } from "@tanstack/react-router";
import { finishTrafficOAuth } from "@/server/traffic-oauth";

export const Route = createFileRoute("/api/analytics/google/callback")({
	server: { handlers: { GET: ({ request }: { request: Request }) => finishTrafficOAuth(request) } },
});
