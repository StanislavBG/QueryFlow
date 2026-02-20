import { pgTable, text, serial, varchar, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  contentType: varchar("content_type", { length: 50 }).notNull().default('text'), // 'text', 'json', 'md'
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true });

export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;

export type CreateDocumentRequest = InsertDocument;
export type DocumentResponse = Document;
export type DocumentsListResponse = Document[];

// SQL Queries table
export const sqlQueries = pgTable("sql_queries", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }),
  title: varchar("title", { length: 255 }).notNull().default("Untitled Query"),
  content: text("content").notNull().default(""),
  formattedContent: text("formatted_content"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSqlQuerySchema = createInsertSchema(sqlQueries).omit({ id: true, createdAt: true, updatedAt: true });
export const updateSqlQuerySchema = insertSqlQuerySchema.partial();

export type SqlQuery = typeof sqlQueries.$inferSelect;
export type InsertSqlQuery = z.infer<typeof insertSqlQuerySchema>;
export type UpdateSqlQuery = z.infer<typeof updateSqlQuerySchema>;

// Query Feedback table
export const queryFeedback = pgTable("query_feedback", {
  id: serial("id").primaryKey(),
  queryId: integer("query_id").notNull(),
  agentType: varchar("agent_type", { length: 50 }).notNull(), // 'structure', 'optimization', 'error', 'style'
  severity: varchar("severity", { length: 20 }).notNull(), // 'info', 'warning', 'error', 'success'
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  suggestion: text("suggestion"),
  lineNumber: integer("line_number"),
  isResolved: boolean("is_resolved").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertFeedbackSchema = createInsertSchema(queryFeedback).omit({ id: true, createdAt: true });

export type QueryFeedbackRow = typeof queryFeedback.$inferSelect;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;

// Agent Settings table
export const agentSettings = pgTable("agent_settings", {
  id: serial("id").primaryKey(),
  agentType: varchar("agent_type", { length: 50 }).notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(1), // 1=low, 2=medium, 3=high
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAgentSettingsSchema = createInsertSchema(agentSettings).omit({ id: true, updatedAt: true });
export const updateAgentSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().min(1).max(3).optional(),
  config: z.record(z.unknown()).optional(),
});

export type AgentSettings = typeof agentSettings.$inferSelect;
export type InsertAgentSettings = z.infer<typeof insertAgentSettingsSchema>;
export type UpdateAgentSettings = z.infer<typeof updateAgentSettingsSchema>;

// Formatting Rules table
export const formattingRules = pgTable("formatting_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFormattingRuleSchema = createInsertSchema(formattingRules).omit({ id: true, updatedAt: true });
export const updateFormattingRuleSchema = z.object({
  enabled: z.boolean().optional(),
  value: z.string().optional(),
});

export type FormattingRule = typeof formattingRules.$inferSelect;
export type InsertFormattingRule = z.infer<typeof insertFormattingRuleSchema>;
export type UpdateFormattingRule = z.infer<typeof updateFormattingRuleSchema>;

// User Schemas table (DDL definitions for validation)
export const userSchemas = pgTable("user_schemas", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }),
  name: varchar("name", { length: 255 }).notNull(),
  rawContent: text("raw_content").notNull(),
  parsedDdl: text("parsed_ddl").notNull().default(""),
  tables: jsonb("tables").$type<Array<{ name: string; columns: string[] }>>().default([]),
  fileName: varchar("file_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchemaSchema = createInsertSchema(userSchemas).omit({ id: true, createdAt: true, updatedAt: true });
export const updateUserSchemaSchema = insertUserSchemaSchema.partial();

export type UserSchema = typeof userSchemas.$inferSelect;
export type InsertUserSchema = z.infer<typeof insertUserSchemaSchema>;
export type UpdateUserSchema = z.infer<typeof updateUserSchemaSchema>;

// Chat Messages table (persistent conversations)
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }),
  role: varchar("role", { length: 20 }).notNull().default("user"),
  content: text("content").notNull(),
  queryId: integer("query_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
