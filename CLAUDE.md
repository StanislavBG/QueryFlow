# QueryFlow — Project Guidelines

## Architecture Principles

- **All buttons, parsers, and smart features must be LLM-based.** Do not write local heuristic/regex parsing logic or rule-based feature implementations. Any intelligent behavior (schema parsing, format detection, query analysis, etc.) should go through an LLM call.

## Replit Build Environment

Replit is the build and deployment environment for this project. Claude must maintain `replit.md` so that the user only needs to **git sync** and **deploy** on Replit — no manual steps beyond that (except `npm install` when `package.json` changes).

### `replit.md` Maintenance Rules
- **Never reference `drizzle-kit`** or any migration tooling in `replit.md`. Replit's deployment provisioner reads this file and auto-generates destructive SQL migrations (DROP TABLE, DROP COLUMN) when it detects migration tool references.
- When adding new database tables or columns, update `replit.md` to reflect the current schema under the "Tables" section.
- When adding new API endpoints, update the "Key API Endpoints" section in `replit.md`.
- When adding new environment variables, update the "Required Environment Variables" section in `replit.md`.
- Keep the "Key NPM Dependencies" section current when significant packages are added or removed.
- The "Migration Strategy" and "Deployment" sections must always accurately describe the `ensureTables()` pattern and explicitly state that no migration tooling is used.

## Pre-Deploy Checklist (Replit)

After git-sync and before building/deploying, check if any of these apply. If they do, **notify the user with the exact command(s) to run in the Replit Shell before clicking Build/Deploy.**

### 1. Dependencies changed (`package.json` was modified)
Run in Replit Shell:
```
npm install
```

### 2. New database table or column added to `server/db.ts`
No manual action needed — `ensureTables()` runs automatically on every server start using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Just deploy normally.

**However**, if a column was **renamed or its type changed** (not just added), the user must run a manual migration. Notify the user with the exact `ALTER TABLE` SQL to run in the Replit Database tab or Shell:
```
# Example — adjust to the actual change:
psql $DATABASE_URL -c "ALTER TABLE <table> RENAME COLUMN <old> TO <new>;"
psql $DATABASE_URL -c "ALTER TABLE <table> ALTER COLUMN <col> TYPE <new_type>;"
```

### 3. New environment variable introduced
Notify the user to add it in Replit **Secrets** tab before deploying. List the variable name and a description of what value it expects.

### 4. Schema file (`shared/schema.ts`) changed
No manual migration step — the Drizzle schema is used only for ORM types and queries, not for migrations. Table creation is handled by `ensureTables()` in `server/db.ts`. If a new table/column was added to the schema, make sure the matching `CREATE TABLE` / `ADD COLUMN` was also added to `ensureTables()`.

### 5. No `drizzle-kit` in this project
`drizzle-kit` was intentionally removed to prevent Replit's deployment provisioner from generating destructive migrations (DROP TABLE, DROP COLUMN). Do **not** re-add it. All schema management goes through `ensureTables()` in `server/db.ts`.

## Testing Requirements

### Schema parser changes
Whenever `server/schema-parser.ts` or the LLM schema-parsing prompt in `server/llm.ts` is modified, **always** verify parsing works against the test fixtures below before committing. Run the server locally and POST each fixture to `/api/schemas` to confirm tables are detected.

**Test fixtures** (plain-text MySQL DESCRIBE output — must parse correctly):

```
DESCRIBE gsm.temp_lan_wlan_cbom;
TYPE	varchar(4)	YES	MUL
Date_Uploaded	date	NO
ITEM_IN_BOM	varchar(10)	NO	PRI
FYFQ	varchar(6)	NO	PRI
Partner	varchar(15)	NO	PRI
Product_SKU	varchar(20)	NO	PRI

DESCRIBE gsm.lan_wlan_actuals;
Date_Uploaded	date	YES
TYPE	varchar(4)	YES	MUL
Partner	varchar(15)	NO	PRI
FYFQ	varchar(6)	NO	PRI
Product_SKU	varchar(20)	NO	PRI
Product_Used_In	varchar(20)	NO	PRI
Qty_Ship	decimal(10,2)	YES
```

Expected result: 2 tables (`temp_lan_wlan_cbom`, `lan_wlan_actuals`) with correct columns and primary keys.
