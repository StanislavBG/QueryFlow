import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import {
  documents,
  sqlQueries,
  queryFeedback,
  agentSettings,
  formattingRules,
  userSchemas,
  type CreateDocumentRequest,
  type DocumentResponse,
  type InsertSqlQuery,
  type UpdateSqlQuery,
  type SqlQuery,
  type InsertFeedback,
  type QueryFeedbackRow,
  type AgentSettings,
  type InsertAgentSettings,
  type UpdateAgentSettings,
  type FormattingRule,
  type InsertFormattingRule,
  type UpdateFormattingRule,
  type UserSchema,
  type InsertUserSchema,
  type UpdateUserSchema,
} from "@shared/schema";

export interface IStorage {
  // Documents
  getDocuments(): Promise<DocumentResponse[]>;
  createDocument(doc: CreateDocumentRequest): Promise<DocumentResponse>;

  // SQL Queries
  getSqlQueries(): Promise<SqlQuery[]>;
  getSqlQuery(id: number): Promise<SqlQuery | undefined>;
  createSqlQuery(query: InsertSqlQuery): Promise<SqlQuery>;
  updateSqlQuery(id: number, query: UpdateSqlQuery): Promise<SqlQuery | undefined>;
  deleteSqlQuery(id: number): Promise<boolean>;

  // Feedback
  getFeedbackByQueryId(queryId: number): Promise<QueryFeedbackRow[]>;
  createFeedback(feedback: InsertFeedback): Promise<QueryFeedbackRow>;
  createFeedbackBatch(items: InsertFeedback[]): Promise<QueryFeedbackRow[]>;
  deleteFeedbackByQueryId(queryId: number): Promise<void>;
  resolveFeedback(id: number): Promise<QueryFeedbackRow | undefined>;

  // Agent Settings
  getAgentSettings(): Promise<AgentSettings[]>;
  getAgentSettingsByType(agentType: string): Promise<AgentSettings | undefined>;
  upsertAgentSettings(settings: InsertAgentSettings): Promise<AgentSettings>;
  updateAgentSettings(agentType: string, update: UpdateAgentSettings): Promise<AgentSettings | undefined>;

  // Formatting Rules
  getFormattingRules(): Promise<FormattingRule[]>;
  getFormattingRule(name: string): Promise<FormattingRule | undefined>;
  upsertFormattingRule(rule: InsertFormattingRule): Promise<FormattingRule>;
  updateFormattingRule(name: string, update: UpdateFormattingRule): Promise<FormattingRule | undefined>;

  // User Schemas
  getUserSchemas(): Promise<UserSchema[]>;
  getUserSchema(id: number): Promise<UserSchema | undefined>;
  createUserSchema(schema: InsertUserSchema): Promise<UserSchema>;
  updateUserSchema(id: number, schema: UpdateUserSchema): Promise<UserSchema | undefined>;
  deleteUserSchema(id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  // Documents
  async getDocuments(): Promise<DocumentResponse[]> {
    return await db.select().from(documents);
  }

  async createDocument(insertDoc: CreateDocumentRequest): Promise<DocumentResponse> {
    const [doc] = await db.insert(documents).values(insertDoc).returning();
    return doc;
  }

  // SQL Queries
  async getSqlQueries(): Promise<SqlQuery[]> {
    return await db.select().from(sqlQueries).orderBy(desc(sqlQueries.updatedAt));
  }

  async getSqlQuery(id: number): Promise<SqlQuery | undefined> {
    const [query] = await db.select().from(sqlQueries).where(eq(sqlQueries.id, id));
    return query;
  }

  async createSqlQuery(query: InsertSqlQuery): Promise<SqlQuery> {
    const [created] = await db.insert(sqlQueries).values(query).returning();
    return created;
  }

  async updateSqlQuery(id: number, query: UpdateSqlQuery): Promise<SqlQuery | undefined> {
    const [updated] = await db
      .update(sqlQueries)
      .set({ ...query, updatedAt: new Date() })
      .where(eq(sqlQueries.id, id))
      .returning();
    return updated;
  }

  async deleteSqlQuery(id: number): Promise<boolean> {
    // Delete associated feedback first
    await db.delete(queryFeedback).where(eq(queryFeedback.queryId, id));
    const result = await db.delete(sqlQueries).where(eq(sqlQueries.id, id)).returning();
    return result.length > 0;
  }

  // Feedback
  async getFeedbackByQueryId(queryId: number): Promise<QueryFeedbackRow[]> {
    return await db.select().from(queryFeedback).where(eq(queryFeedback.queryId, queryId));
  }

  async createFeedback(feedback: InsertFeedback): Promise<QueryFeedbackRow> {
    const [created] = await db.insert(queryFeedback).values(feedback).returning();
    return created;
  }

  async createFeedbackBatch(items: InsertFeedback[]): Promise<QueryFeedbackRow[]> {
    if (items.length === 0) return [];
    return await db.insert(queryFeedback).values(items).returning();
  }

  async deleteFeedbackByQueryId(queryId: number): Promise<void> {
    await db.delete(queryFeedback).where(eq(queryFeedback.queryId, queryId));
  }

  async resolveFeedback(id: number): Promise<QueryFeedbackRow | undefined> {
    const [updated] = await db
      .update(queryFeedback)
      .set({ isResolved: true })
      .where(eq(queryFeedback.id, id))
      .returning();
    return updated;
  }

  // Agent Settings
  async getAgentSettings(): Promise<AgentSettings[]> {
    return await db.select().from(agentSettings);
  }

  async getAgentSettingsByType(agentType: string): Promise<AgentSettings | undefined> {
    const [settings] = await db
      .select()
      .from(agentSettings)
      .where(eq(agentSettings.agentType, agentType));
    return settings;
  }

  async upsertAgentSettings(settings: InsertAgentSettings): Promise<AgentSettings> {
    const existing = await this.getAgentSettingsByType(settings.agentType);
    if (existing) {
      const [updated] = await db
        .update(agentSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(agentSettings.agentType, settings.agentType))
        .returning();
      return updated;
    }
    const [created] = await db.insert(agentSettings).values(settings).returning();
    return created;
  }

  async updateAgentSettings(agentType: string, update: UpdateAgentSettings): Promise<AgentSettings | undefined> {
    const [updated] = await db
      .update(agentSettings)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(agentSettings.agentType, agentType))
      .returning();
    return updated;
  }

  // Formatting Rules
  async getFormattingRules(): Promise<FormattingRule[]> {
    return await db.select().from(formattingRules);
  }

  async getFormattingRule(name: string): Promise<FormattingRule | undefined> {
    const [rule] = await db
      .select()
      .from(formattingRules)
      .where(eq(formattingRules.name, name));
    return rule;
  }

  async upsertFormattingRule(rule: InsertFormattingRule): Promise<FormattingRule> {
    const existing = await this.getFormattingRule(rule.name);
    if (existing) {
      const [updated] = await db
        .update(formattingRules)
        .set({ ...rule, updatedAt: new Date() })
        .where(eq(formattingRules.name, rule.name))
        .returning();
      return updated;
    }
    const [created] = await db.insert(formattingRules).values(rule).returning();
    return created;
  }

  async updateFormattingRule(name: string, update: UpdateFormattingRule): Promise<FormattingRule | undefined> {
    const [updated] = await db
      .update(formattingRules)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(formattingRules.name, name))
      .returning();
    return updated;
  }
  // User Schemas
  async getUserSchemas(): Promise<UserSchema[]> {
    return await db.select().from(userSchemas).orderBy(desc(userSchemas.updatedAt));
  }

  async getUserSchema(id: number): Promise<UserSchema | undefined> {
    const [schema] = await db.select().from(userSchemas).where(eq(userSchemas.id, id));
    return schema;
  }

  async createUserSchema(schema: InsertUserSchema): Promise<UserSchema> {
    const [created] = await db.insert(userSchemas).values(schema).returning();
    return created;
  }

  async updateUserSchema(id: number, schema: UpdateUserSchema): Promise<UserSchema | undefined> {
    const [updated] = await db
      .update(userSchemas)
      .set({ ...schema, updatedAt: new Date() })
      .where(eq(userSchemas.id, id))
      .returning();
    return updated;
  }

  async deleteUserSchema(id: number): Promise<boolean> {
    const result = await db.delete(userSchemas).where(eq(userSchemas.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
