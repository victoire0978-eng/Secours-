# NLSbox

NLSbox lets users discover anime, films, series, music, and scans, then stream, download, and manage their media library.

## Run & Operate

- `pnpm --filter @workspace/nlsbox run dev` — run the full NLSbox web app and proxy server
- `pnpm --filter @workspace/nlsbox run typecheck` — typecheck the NLSbox frontend
- `pnpm --filter @workspace/nlsbox run build` — build the NLSbox frontend and production server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- NLSbox uses the Firebase configuration committed with the imported app and proxies media/search requests through the server.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React + Vite
- Proxy/server: Express 4
- Auth and sync: Firebase Auth + Firestore
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/nlsbox/src/` — NLSbox UI, services, hooks, and media utilities
- `artifacts/nlsbox/server.ts` — search, Jikan metadata, streaming, download, and SPA serving routes
- `artifacts/nlsbox/firebase-applet-config.json` — Firebase app configuration used by the client
- `artifacts/nlsbox/.replit-artifact/artifact.toml` — preview and production serving configuration

## Architecture decisions

- The NLSbox artifact owns `/` and `/api/*`; the generic API artifact only retains `/api/healthz` so route ownership is unambiguous.
- The production service runs the Express server so proxy and streaming endpoints work alongside the built Vite app.
- Search and media calls stay relative to the deployed app so they work through Replit's path router.

## Product

- Search configured media channels and Jikan anime metadata
- Stream or download episodes through proxy routes
- Manage downloads, offline media, settings, notifications, feedback, and Firebase-backed accounts

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
