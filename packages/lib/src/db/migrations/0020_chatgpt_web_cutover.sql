-- Active settings move to one acquisition target. Historical runs/citations/raw payloads stay untouched.
UPDATE brands b SET enabled_targets = ARRAY(
  SELECT DISTINCT CASE
    WHEN split_part(t, ':', 1) = 'chatgpt'
     AND split_part(t, ':', 2) IN ('brightdata','olostep','cloro','oxylabs','dataforseo-scraper')
      THEN 'chatgpt:dataforseo-scraper:online'
    ELSE t END
  FROM unnest(b.enabled_targets) AS t
  WHERE split_part(t, ':', 2) <> 'brightdata' OR split_part(t, ':', 1) = 'chatgpt'
  ORDER BY 1
), updated_at = now()
WHERE enabled_targets IS NOT NULL AND EXISTS (
  SELECT 1 FROM unnest(b.enabled_targets) AS t
  WHERE split_part(t, ':', 2) = 'brightdata'
     OR (split_part(t, ':', 1) = 'chatgpt' AND split_part(t, ':', 2) IN ('olostep','cloro','oxylabs','dataforseo-scraper')
         AND t <> 'chatgpt:dataforseo-scraper:online')
);
--> statement-breakpoint
-- Preserve the attempted acquisition identity; only unfinished retired jobs change state.
UPDATE measurement_attempts SET status = 'failed', error_code = 'provider_retired', completed_at = now()
WHERE status IN ('queued','running') AND (
  provider = 'brightdata' OR (model = 'chatgpt' AND provider IN ('olostep','cloro','oxylabs'))
);
