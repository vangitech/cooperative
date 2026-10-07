# Vercel env vars — copy into dashboard (project → Settings → Environment Variables)

> Secrets are NOT in this file. Where you see `<same as backend/.env>`,
> copy the value from your local `backend/.env` (never commit real keys).
> After saving, **Redeploy** the project (vars apply at build/boot time).

## Frontend project (`cooperative-tgnp`)

| Key | Value |
|-----|-------|
| `VITE_API_URL` | `https://cooperative-khaki.vercel.app/api` |
| `VITE_SUPABASE_URL` | `https://tpnjkhquyerhvtlgugvc.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_z1b4mhXgtNTXbdvmwCqkUw_ZPIIT3Ik` |

Apply to: Production (and Preview if you want previews to work).
Then: Deployments → Redeploy (Vite bakes these in at build time).

## Backend project (`cooperative-khaki`)

| Key | Value |
|-----|-------|
| `DATABASE_URL` | `<same as backend/.env>` |
| `JWT_SECRET` | `<same as backend/.env>` |
| `JWT_EXPIRES_IN` | `7d` |
| `NODE_ENV` | `production` |
| `CLIENT_URL` | `https://cooperative-tgnp.vercel.app` |
| `FLW_PUBLIC_KEY` | `<same as backend/.env>` (test key) |
| `FLW_SECRET_KEY` | `<same as backend/.env>` (test key) |
| `FLW_WEBHOOK_HASH` | _(leave unset for now — set when webhook URL goes public)_ |
| `FUND_CALLBACK_URL` | `https://cooperative-tgnp.vercel.app/payment/callback` |

Apply to: Production. Then: Deployments → Redeploy.

## Order
1. Backend env → deploy → check `/api/health`
2. Frontend env → redeploy → check `/login` loads data
