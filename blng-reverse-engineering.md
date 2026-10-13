# Reverse engineering app.blng.ai (BLNG, AI jewelry design)

Method: REA (`morluto/rea`, `npx rea-agents analyze-javascript-application`) run statically on the publicly served frontend (`index.html`, `index-Cbrnz8ec.js` 6.3 MB, `index.css`), plus grep of the bundle. Nothing was executed, no logins were attempted, and no authenticated or private endpoints were called. REA evidence ID: `ev_3777a34fdfb62593c331cf9f03463d41b364035f949ed7981f0f773c9c0f8753`.

Limits: REA's JS worker hit its heap limit on the 6 MB single bundle, so graph coverage is partial (it lists 78 endpoint nodes and 4 workers; 0 modules recovered). The findings below combine REA's graph with direct string search. Static presence of a string does not prove it runs.

## What it is
A browser-based design tool for jewelry (title: "BLNG – Your Jewelry Design, Powered by AI"). An iOS app exists too (App Store id 6454143521). Users work in "journeys" (projects) with a chat prompt, image generation, sketching/brushes, 3D model generation, and video templates.

## Frontend
- Vite + React SPA (bundle hash names, `react.dev/errors`), Redux Toolkit (`redux-toolkit.js.org/Errors`), i18next with locize, three.js (about 150 references, with troika text), WebGL2 and OffscreenCanvas, Yjs (CRDT), Stripe.js, AWS RUM, Sanity CMS, and a lazy-loaded `MetronomeSubscribeModal` chunk (usage-based billing UI).
- Hosting: S3 behind CloudFront, no-cache `index.html`, strict CSP and security headers (`x-frame-options: DENY`, HSTS preload).
- Web Workers: `magicWand.worker` (magic-wand selection) and `brushCursor.worker`; blob workers for bundled helpers. A custom raster brush engine exists (brush textures from CloudFront `/brushes/textures/`, env flags like `VITE_BRUSH_STAMP_SHARPEN`).
- Client storage: localStorage, sessionStorage and IndexedDB (33 references), likely for offline caching and drafts.
- Env/config keys visible: `VITE_AUTH_USER_POOL_ID`, `VITE_AUTH_USER_POOL_CLIENT_ID`, `VITE_AUTH_IDENTITY_POOL_ID`, `VITE_AUTH_REDIRECT_URI`, `VITE_BILLING_API`, `VITE_CDN`, `VITE_BUILD_ID`, `VITE_COMPOSITE_PREFIX_CACHE`.

## Backend topology (from the CSP and bundle)
| Host | Role |
|---|---|
| `users.blng.ai` | Accounts, workspaces, invitations, SSO config, MFA backup codes, auth methods, password and provider linking, containers/members |
| `journeys.blng.ai` | Journeys (projects), generations, 3D models and conversions, chat prompt, operations |
| `layers.blng.ai` | Layer storage/processing |
| `billing.blng.ai` | Subscriptions and checkout (Stripe plus Metronome) |
| `auth.app.blng.ai`, Cognito `us-west-2` | Auth (AWS Cognito user and identity pools) |
| `wss://crdt.blng.ai` | Real-time collaboration (Yjs-style CRDT sync) |
| `wss://voice.blng.ai` | Voice input (getUserMedia plus AudioWorklet in the bundle) |
| `wss://gws.blng.ai` | Gateway websocket (purpose not determined) |
| `d2tmpeuohctlx9.cloudfront.net` | Static CDN: brushes, images, fonts |
| `journeys-images-prod.s3-accelerate...` | User image storage |
| `cdn.sanity.io`, `4x3qe5zn.apicdn.sanity.io` | CMS content |

## API shapes seen in client code (paths only)
- `design/journeys`, `design/journeys/{id}`, `/models`, `/models/{id}/conversions`, `/generations`, `/generations/{id}`, `/operations`, `/chat-prompt-v3`, `/room`, `journeys/versions`
- `users/{id}/workspaces[/{ws}/members|invitations|sso-config]`, `users/{id}/containers[/{id}/members|restore]`, `users/{id}/auth/{methods|password|password/code|providers}`, `users/{id}/mfa/backup-codes`, `users/{id}/active-workspace`, `users/{id}/workspace-invitations/{inbox|accept|email-match}`
- `auth/check-email`, `user-preset`, `image-reference`, `subscription(s)`, `checkout/success`
- UI actions: `generate3dTier`, `generateVideoTemplate`; a `RefinedMeshGenerationRequest` type for refined 3D meshes.

## Feature map
1. Chat-driven image generation of jewelry concepts with reference images and user presets.
2. Image to 3D model generation in tiers (including a "refined" mesh), plus model conversions and export formats (glb/stl-style strings appear).
3. Layered canvas editor with custom brushes, magic wand, and a WebGL compositor.
4. Video generation from templates.
5. Real-time multi-user collaboration (CRDT) and voice input.
6. Workspaces with roles, invitations, SSO and MFA (a B2B tier).
7. Subscription and credit billing via Stripe and Metronome.

## Not determined
Which AI models or vendors sit behind generation (they run server-side; the bundle only names endpoints). Server code, API schemas and auth rules cannot be recovered from static frontend analysis. Anything beyond this would require an authenticated session, which was not attempted.

## To rebuild something similar
Suggested stack: React + Redux Toolkit, three.js, Yjs with a websocket server, Cognito (or similar) auth, Stripe, and your own image and 3D generation backend. The design should be your own. REA's disclaimer excludes copying proprietary code or assets.

Raw analysis output is in the session scratchpad (`rea.json`, 840 KB), not committed.
