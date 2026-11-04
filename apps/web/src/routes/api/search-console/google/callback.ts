import { createFileRoute } from "@tanstack/react-router";
import { finishSearchConsoleOAuth } from "@/server/search-console-oauth";

export const Route = createFileRoute("/api/search-console/google/callback")({
	server: { handlers: { GET: ({ request }: { request: Request }) => finishSearchConsoleOAuth(request) } },
});
