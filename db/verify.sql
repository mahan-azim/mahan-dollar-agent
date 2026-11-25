-- Mahan Market Agent: read-only post-migration checks
-- Expected: five tables, zero fabricated customer rows, UUID default for profiles.id.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('profiles','plans','subscriptions','payments','payment_events')
ORDER BY table_name;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;

SELECT conrelid::regclass AS table_name,
       conname AS constraint_name,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid IN ('public.profiles'::regclass, 'public.subscriptions'::regclass,
                   'public.payments'::regclass, 'public.payment_events'::regclass)
ORDER BY table_name, constraint_name;

SELECT 'profiles' AS table_name, COUNT(*) AS rows FROM public.profiles
UNION ALL SELECT 'plans', COUNT(*) FROM public.plans
UNION ALL SELECT 'subscriptions', COUNT(*) FROM public.subscriptions
UNION ALL SELECT 'payments', COUNT(*) FROM public.payments
UNION ALL SELECT 'payment_events', COUNT(*) FROM public.payment_events;
