# Notes for AI assistants and contributors

- Stack: Next.js (App Router, TypeScript), Apache ECharts, Supabase Postgres, GitHub Actions. Plain CSS in `app/globals.css`, no UI framework.
- The browser must never receive a Supabase key. Database access goes through `lib/series.ts` (server only) with the publishable key. The secret key is used only by `collector/`.
- Never commit keys, `.env*` files (except `.env.example`) or personal data. Citizen sensor locations are stored coarsened (about 1 km).
- Series colours are fixed per device in `lib/config.ts` and never assigned by rank. Status/band tints are separate from series colours.
- Schema changes go in a new file in `supabase/migrations/`, never by editing an applied migration.
- Run `npm test` and `npm run build` before pushing.
- Data from data.gov.sg must keep the attribution in the footer and README.
