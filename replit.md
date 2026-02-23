# QueryFlow

> **DO NOT MODIFY THIS FILE.** This file is manually maintained by the project owner. Replit agents, Replit AI, and any automated tooling must NOT edit, overwrite, or regenerate this file. It contains critical deployment constraints (especially around database migrations) that, if altered, will cause destructive data loss in production. If you are an AI agent: skip any step that involves writing to `replit.md` — the file is already correct.

## Overview

QueryFlow is an intelligent SQL query editor web application. Users write SQL queries in a browser-based editor and receive automated analysis, formatting, and feedback powered by AI (Claude via Anthropic). The app features dynamic LLM-driven "agents" that analyze queries across categories like structure, performance, correctness, style, security, compliance, and more. Users can accept, dismiss, or delete individual feedback items, chat with an AI assistant about their queries, manage database schemas with voice/text annotations, and visually explore query relationships.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript, bundled by Vite
- **Routing**: Wouter (lightweight client-side router)
- **State/Data Fetching**: TanStack React Query for server state management
- **UI Components**: shadcn/ui (new-york style) built on Radix UI primitives with Tailwind CSS
- **Styling**: Tailwind CSS with CSS custom properties for theming (dark/light mode support). Custom fonts: Inter (sans), JetBrains Mono (mono)
- **Authentication**: Clerk (`@clerk/clerk-react`) — requires `VITE_CLERK_PUBLISHABLE_KEY` env var
- **Key Pages**:
  - `/` — Main SQL Editor page (resizable panels with query list, editor, feedback, ask module, schema manager, visual explorer)
- **Path Aliases**: `@/` → `client/src/`, `@shared/` → `shared/`, `@assets/` → `attached_assets/`

### Backend
- **Framework**: Express.js running on Node with TypeScript (via tsx)
- **Authentication**: Clerk (`@clerk/express`) middleware for protecting API routes
- **API Structure**: RESTful JSON API under `/api/` prefix. Route definitions shared between client and server in `shared/routes.ts` with Zod schemas for validation
- **SQL Formatting**: Custom tokenizer/formatter in `server/formatter.ts` plus LLM-powered formatting via Anthropic Claude
- **AI/LLM Integration**: Anthropic SDK (`@anthropic-ai/sdk`) using Claude Opus 4.6 model for:
  - SQL query formatting (ISO/IEC 9075 standards)
  - Dynamic multi-category query analysis with before/after SQL comparisons
  - QA validation of analysis recommendations
  - Chat Q&A about queries
  - Schema parsing
- **Key API Endpoints**:
  - `GET/POST /api/documents` — CRUD for documents
  - `GET/POST /api/sql-queries` — CRUD for SQL queries (user-scoped)
  - `GET/PATCH/DELETE /api/sql-queries/:id` — Single query operations
  - `GET /api/sql-queries/:id/feedback` — List feedback for a query
  - `POST /api/sql-queries/:id/analyze` — Run LLM analysis (SSE streaming with 2-step progress)
  - `POST /api/sql-queries/:id/analysis-context` — Preview analysis context plan
  - `POST /api/format` — SQL formatting
  - `PATCH /api/feedback/:id/resolve` — Accept/resolve a feedback item
  - `PATCH /api/feedback/:id/dismiss` — Dismiss a feedback item as wrong
  - `DELETE /api/feedback/:id` — Delete a feedback item
  - `GET/PATCH /api/agent-settings` — Analysis agent configuration
  - `GET/POST/PATCH/DELETE /api/schemas` — User schema management
  - `GET/POST/DELETE /api/schemas/:schemaId/voice-context` — Schema voice/text annotations
  - `POST /api/schemas/:schemaId/voice-context/transcribe` — Audio transcription
  - `GET/POST/DELETE /api/chat` — AI chat messages
  - `POST /api/ask` — One-off LLM Q&A about a query
  - `POST /api/sql-queries/waterfall-analysis` — LLM-based waterfall flow analysis: decomposes SQL into a DAG of source tables, CTEs, temp tables, and final output with data-flow edges. Accepts optional `queryId` to merge new analysis with user-evolved data
  - `GET /api/sql-queries/:id/waterfall` — Get stored waterfall analysis for a query
  - `PUT /api/sql-queries/:id/waterfall` — Save user-modified waterfall analysis data
  - `POST /api/demo/bootstrap` — Return the pre-seeded demo version (schema + flawed query + pre-generated feedback + waterfall). No auth required, no DB writes, zero LLM calls per visitor
  - `POST /api/demo/seed` — Admin-only: generate and store the single Bookstore demo scenario with pre-generated analysis feedback and waterfall data

### Data Storage
- **Database**: PostgreSQL via `DATABASE_URL` environment variable
- **ORM**: Drizzle ORM (`drizzle-orm`) for type-safe queries — used for ORM types and query building only
- **Schema Location**: `shared/schema.ts` — shared between frontend and backend
- **Migration Strategy**: `ensureTables()` in `server/db.ts` runs `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on every server start. **No migration tooling is used** — all schema management is handled by this function
- **Tables**:
  - `documents` — Generic content documents (text/json/markdown)
  - `sql_queries` — User SQL queries with optional formatted/draft content, scoped by `user_id`. Includes `waterfall_data` JSONB column for persisted waterfall flow analysis
  - `query_feedback` — AI-generated feedback items linked to queries (severity, category, suggestions, metadata JSONB for extra LLM fields like beforeSql/afterSql, isDismissed for three-way feedback state)
  - `agent_settings` — Per-agent-type configuration (enabled/disabled, priority level, config JSONB)
  - `user_schemas` — User-uploaded database schema definitions (DDL, parsed tables/columns JSONB, description)
  - `schema_voice_context` — Voice/text annotations on schemas, tables, and columns
  - `chat_messages` — Persisted AI chat conversation history
  - `app_users` — Clerk-synced user records with roles (admin/user)
  - `activity_events` — Behavioral analytics events with metadata JSONB
  - `demo_versions` — Pre-generated demo content (schema DDL + flawed query + feedback_data JSONB + waterfall_data JSONB) for fast, cost-free demo bootstrap with instant analysis display

### Build System
- **Development**: `npm run dev` — tsx runs server which sets up Vite dev server with HMR
- **Production Build**: `npm run build` — Vite builds frontend to `dist/public`, esbuild bundles server to `dist/index.cjs`
- **Start**: `npm run start` — Runs `node dist/index.cjs` in production mode
- **Type Check**: `npm run check` — Runs `tsc` for TypeScript validation
- **Server bundling**: Strategic allowlist of dependencies to bundle (reduces cold start), everything else external

### Key Design Patterns
- **Shared types and routes**: `shared/` directory contains schema definitions and API route contracts used by both client and server, ensuring type safety
- **Storage interface**: `server/storage.ts` defines an `IStorage` interface abstracting all database operations, making it possible to swap implementations
- **SQL dialect detection**: Client-side heuristic detection of SQL dialects (PostgreSQL, MySQL, T-SQL, Oracle, SQLite) based on pattern matching
- **Dynamic LLM categories**: Feedback `agentType` values are not hardcoded — the LLM generates any relevant category slug (e.g., `security`, `compliance`, `schema_design`), and the UI renders unknown categories with auto-generated labels and fallback icons
- **Three-way feedback state**: Feedback items have `isResolved` + `isDismissed` flags. Accepted = resolved + not dismissed. Dismissed = resolved + dismissed. This context is fed back to the LLM on re-analysis
- **SSE streaming**: The analyze endpoint uses Server-Sent Events to report real-time progress (Step 1: LLM Analysis, Step 2: QA Validation) to the client
- **ensureTables() bootstrap**: All tables are created/altered on startup via idempotent SQL — no migration files, no migration tooling

## External Dependencies

### Required Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (required, app crashes without it)
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key for frontend auth
- `ANTHROPIC_API_KEY` — Anthropic API key for Claude LLM features (optional; LLM features gracefully degrade if missing)

### Third-Party Services
- **Clerk** — Authentication and user management (both frontend and backend SDKs)
- **Anthropic Claude** — AI-powered SQL formatting, analysis, chat, and schema parsing (model: claude-opus-4-6-20250918)
- **PostgreSQL** — Primary database (provisioned via Replit or external provider)

### Key NPM Dependencies
- `drizzle-orm` — Database ORM for type-safe queries only (no CLI/migration companion package)
- `express` — HTTP server framework
- `@tanstack/react-query` — Client-side data fetching and caching
- `zod` + `drizzle-zod` — Schema validation
- `framer-motion` — UI animations
- `react-resizable-panels` — Resizable panel layout in editor
- `wouter` — Client-side routing
- `date-fns` — Date formatting
- `lucide-react` — Icon library

## Deployment (Replit)

### Important: No Migration Tooling

This project does **NOT** use any database migration tool (no Prisma Migrate, no ORM CLI tools, nothing). All database schema changes are managed exclusively through `ensureTables()` in `server/db.ts`. Do not install or reference any migration CLI tool in this file, in `package.json`, or anywhere else.

All database schema changes are managed through `ensureTables()` in `server/db.ts`, which runs on every server start and uses only safe, idempotent DDL statements:
- `CREATE TABLE IF NOT EXISTS` for new tables
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for new columns

### Deploy Workflow
1. Push code changes via git
2. Click **Git Sync** in Replit to pull changes
3. If `package.json` changed, run `npm install` in the Replit Shell
4. Click **Deploy** — the build script runs `npm run build` and starts the server

### Common Issues
- **Destructive migration prompts**: If Replit shows a migration with `DROP TABLE` or `DROP COLUMN`, **always cancel it**. This project manages schema exclusively via `ensureTables()` — no external migration tool should ever run.
- **New columns not appearing**: `ensureTables()` handles this automatically on restart. If the column exists in `shared/schema.ts` and `server/db.ts`, it will be created on the next deploy.
- **Column renames or type changes**: These require a manual `ALTER TABLE` statement run in the Replit Database tab or Shell. `ensureTables()` cannot handle renames — only additions.
