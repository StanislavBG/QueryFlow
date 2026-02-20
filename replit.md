# replit.md

## Overview

QueryFlow is an intelligent SQL query editor web application. Users write SQL queries in a browser-based editor and receive automated analysis, formatting, and feedback powered by AI (Claude via Anthropic). The app includes specialized "agents" that analyze queries across categories like structure, performance, correctness, style, formatting, and documentation. Users can also chat with an AI assistant about their queries, manage database schemas, and visually explore query relationships.

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
  - Home page exists but editor is the primary route
- **Path Aliases**: `@/` → `client/src/`, `@shared/` → `shared/`, `@assets/` → `attached_assets/`

### Backend
- **Framework**: Express.js running on Node with TypeScript (via tsx)
- **Authentication**: Clerk (`@clerk/express`) middleware for protecting API routes
- **API Structure**: RESTful JSON API under `/api/` prefix. Route definitions shared between client and server in `shared/routes.ts` with Zod schemas for validation
- **SQL Formatting**: Custom tokenizer/formatter in `server/formatter.ts` plus LLM-powered formatting via Anthropic Claude
- **AI/LLM Integration**: Anthropic SDK (`@anthropic-ai/sdk`) using Claude Opus 4.6 model for:
  - SQL query formatting (ISO/IEC 9075 standards)
  - Query analysis across multiple categories
  - Chat Q&A about queries
  - Schema parsing
- **Key API Endpoints**:
  - `/api/documents` — CRUD for documents
  - `/api/sql-queries` — CRUD for SQL queries (user-scoped)
  - `/api/sql-queries/:id/feedback` — Query feedback/analysis
  - `/api/sql-queries/:id/format` — SQL formatting
  - `/api/agent-settings` — Analysis agent configuration
  - `/api/schemas` — User schema management
  - `/api/chat` — AI chat messages

### Data Storage
- **Database**: PostgreSQL via `DATABASE_URL` environment variable
- **ORM**: Drizzle ORM with `drizzle-kit` for migrations
- **Schema Location**: `shared/schema.ts` — shared between frontend and backend
- **Tables**:
  - `documents` — Generic content documents (text/json/markdown)
  - `sql_queries` — User SQL queries with optional formatted content, scoped by `user_id`
  - `query_feedback` — AI-generated feedback items linked to queries (severity, category, suggestions)
  - `agent_settings` — Per-agent-type configuration (enabled/disabled, severity level)
  - `user_schemas` — User-uploaded database schema definitions (DDL, parsed tables/columns)
  - `chat_messages` — Persisted AI chat conversation history
- **Startup**: `ensureTables()` runs CREATE TABLE IF NOT EXISTS on startup for bootstrapping without requiring migrations

### Build System
- **Development**: `npm run dev` — tsx runs server which sets up Vite dev server with HMR
- **Production Build**: `npm run build` — Vite builds frontend to `dist/public`, esbuild bundles server to `dist/index.cjs`
- **Server bundling**: Strategic allowlist of dependencies to bundle (reduces cold start), everything else external

### Key Design Patterns
- **Shared types and routes**: `shared/` directory contains schema definitions and API route contracts used by both client and server, ensuring type safety
- **Storage interface**: `server/storage.ts` defines an `IStorage` interface abstracting all database operations, making it possible to swap implementations
- **SQL dialect detection**: Client-side heuristic detection of SQL dialects (PostgreSQL, MySQL, T-SQL, Oracle, SQLite) based on pattern matching

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
- `drizzle-orm` + `drizzle-kit` — Database ORM and migration tooling
- `express` — HTTP server framework
- `@tanstack/react-query` — Client-side data fetching and caching
- `zod` + `drizzle-zod` — Schema validation
- `framer-motion` — UI animations
- `react-resizable-panels` — Resizable panel layout in editor
- `wouter` — Client-side routing
- `date-fns` — Date formatting
- `connect-pg-simple` — PostgreSQL session store (available but sessions may not be actively used with Clerk)