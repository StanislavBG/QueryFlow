import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/**
 * Ensures all required tables exist in the database.
 * Uses CREATE TABLE IF NOT EXISTS so it's safe to call on every startup.
 */
export async function ensureTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        content_type VARCHAR(50) NOT NULL DEFAULT 'text',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sql_queries (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        title VARCHAR(255) NOT NULL DEFAULT 'Untitled Query',
        content TEXT NOT NULL DEFAULT '',
        formatted_content TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Add columns to existing tables if missing
      ALTER TABLE sql_queries ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
      ALTER TABLE sql_queries ADD COLUMN IF NOT EXISTS draft_content TEXT;

      CREATE TABLE IF NOT EXISTS query_feedback (
        id SERIAL PRIMARY KEY,
        query_id INTEGER NOT NULL,
        agent_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        suggestion TEXT,
        line_number INTEGER,
        is_resolved BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agent_settings (
        id SERIAL PRIMARY KEY,
        agent_type VARCHAR(50) NOT NULL UNIQUE,
        enabled BOOLEAN NOT NULL DEFAULT true,
        priority INTEGER NOT NULL DEFAULT 1,
        config JSONB DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_schemas (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        name VARCHAR(255) NOT NULL,
        raw_content TEXT NOT NULL,
        parsed_ddl TEXT NOT NULL DEFAULT '',
        tables JSONB DEFAULT '[]',
        file_name VARCHAR(255),
        description TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE user_schemas ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
      ALTER TABLE user_schemas ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        content TEXT NOT NULL,
        query_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_users (
        id SERIAL PRIMARY KEY,
        clerk_id VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        display_name VARCHAR(255),
        first_seen TIMESTAMP DEFAULT NOW(),
        last_active TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS activity_events (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        action VARCHAR(100) NOT NULL,
        resource VARCHAR(50),
        resource_id INTEGER,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
}
