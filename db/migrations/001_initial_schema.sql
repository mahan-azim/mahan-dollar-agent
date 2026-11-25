-- Mahan Market Agent / PostgreSQL schema migration
-- Schema only: no user, plan, subscription, or payment rows are inserted.
-- Requires a previously created public.profiles table with:
--   id uuid PRIMARY KEY, email text NOT NULL, username text NULL.
-- Before applying to production, verify the existing schema and test restoring a backup.

BEGIN;

ALTER TABLE public.profiles
    ALTER COLUMN id SET DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS profile_url text,
    ADD COLUMN IF NOT EXISTS telegram_chat_id text,
    ADD COLUMN IF NOT EXISTS bale_chat_id text,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Case-insensitive uniqueness for account identifiers.
CREATE UNIQUE INDEX IF NOT EXISTS mma_profiles_email_ci_uidx
    ON public.profiles (lower(btrim(email)));
CREATE UNIQUE INDEX IF NOT EXISTS mma_profiles_username_ci_uidx
    ON public.profiles (lower(btrim(username)))
    WHERE username IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mma_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER mma_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.mma_touch_updated_at();

-- Plan catalogue. Pricing will be defined when real offers are confirmed.
CREATE TABLE IF NOT EXISTS public.plans (
    code text PRIMARY KEY,
    name text NOT NULL,
    description text,
    price_minor bigint,
    currency char(3) NOT NULL DEFAULT 'IRR',
    billing_period text NOT NULL CHECK (billing_period IN ('none', 'monthly', 'yearly')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mma_plans_valid_price CHECK (price_minor IS NULL OR price_minor >= 0),
    CONSTRAINT mma_plans_valid_code CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$')
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    plan_code text NOT NULL REFERENCES public.plans(code) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'suspended')),
    starts_at timestamptz,
    expires_at timestamptz,
    auto_renew boolean NOT NULL DEFAULT false,
    external_subscription_id text,
    provider text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mma_subscriptions_valid_window
        CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS mma_subscriptions_user_idx
    ON public.subscriptions(user_id, status, expires_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mma_subscriptions_external_uidx
    ON public.subscriptions(provider, external_subscription_id)
    WHERE provider IS NOT NULL AND external_subscription_id IS NOT NULL;
CREATE OR REPLACE TRIGGER mma_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.mma_touch_updated_at();

-- Payment records. Amounts are integers in the payment provider's currency unit.
-- Never store card PAN, CVV, provider secrets, or unverified payment claims.
CREATE TABLE IF NOT EXISTS public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    currency char(3) NOT NULL DEFAULT 'IRR',
    provider text NOT NULL,
    provider_reference text,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled', 'refunded')),
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mma_payments_ref_nonblank
        CHECK (provider_reference IS NULL OR length(btrim(provider_reference)) > 0)
);
CREATE INDEX IF NOT EXISTS mma_payments_user_idx
    ON public.payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mma_payments_subscription_idx
    ON public.payments(subscription_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mma_payments_provider_reference_uidx
    ON public.payments(provider, provider_reference)
    WHERE provider_reference IS NOT NULL;
CREATE OR REPLACE TRIGGER mma_payments_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.mma_touch_updated_at();

-- Idempotency log for provider notifications; verification belongs on the backend.
CREATE TABLE IF NOT EXISTS public.payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS mma_payment_events_payment_idx
    ON public.payment_events(payment_id, received_at DESC);

COMMIT;
