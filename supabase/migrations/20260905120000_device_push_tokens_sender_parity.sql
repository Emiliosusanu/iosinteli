-- Align device_push_tokens with Nest smart-notification sender expectations.
-- Additive: safe on the thin 20260902103000 schema (token PK) and on Nest's
-- richer table (uuid id + UNIQUE token).

ALTER TABLE public.device_push_tokens ADD COLUMN IF NOT EXISTS id UUID;
ALTER TABLE public.device_push_tokens ADD COLUMN IF NOT EXISTS bundle_id TEXT;
ALTER TABLE public.device_push_tokens ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE public.device_push_tokens ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE public.device_push_tokens ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE public.device_push_tokens ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

UPDATE public.device_push_tokens
SET
  id = COALESCE(id, gen_random_uuid()),
  last_seen_at = COALESCE(last_seen_at, COALESCE(updated_at, NOW())),
  platform = COALESCE(platform, 'ios'),
  environment = COALESCE(environment, 'production'),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, NOW())
WHERE id IS NULL
   OR last_seen_at IS NULL
   OR platform IS NULL
   OR environment IS NULL
   OR created_at IS NULL
   OR updated_at IS NULL;

CREATE INDEX IF NOT EXISTS device_push_tokens_active_ios_idx
  ON public.device_push_tokens (last_seen_at DESC)
  WHERE disabled_at IS NULL
    AND invalidated_at IS NULL
    AND (platform IS NULL OR platform = 'ios');

CREATE INDEX IF NOT EXISTS device_push_tokens_user_active_idx
  ON public.device_push_tokens (user_id)
  WHERE disabled_at IS NULL AND invalidated_at IS NULL;
