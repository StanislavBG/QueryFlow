import { db } from "./db";
import { eq, desc, and, isNull, or } from "drizzle-orm";
import {
  documents,
  sqlQueries,
  queryFeedback,
  agentSettings,
  userSchemas,
  chatMessages,
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
  type UserSchema,
  type InsertUserSchema,
  type UpdateUserSchema,
  type ChatMessage,
  type InsertChatMessage,
} from "@shared/schema";

export interface IStorage {
  // Documents
  getDocuments(): Promise<DocumentResponse[]>;
  createDocument(doc: CreateDocumentRequest): Promise<DocumentResponse>;

  // SQL Queries (userId-scoped)
  getSqlQueries(userId?: string): Promise<SqlQuery[]>;
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

  // User Schemas (userId-scoped)
  getUserSchemas(userId?: string): Promise<UserSchema[]>;
  getUserSchema(id: number): Promise<UserSchema | undefined>;
  createUserSchema(schema: InsertUserSchema): Promise<UserSchema>;
  updateUserSchema(id: number, schema: UpdateUserSchema): Promise<UserSchema | undefined>;
  deleteUserSchema(id: number): Promise<boolean>;

  // Chat Messages
  getChatMessages(userId?: string): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  clearChatMessages(userId?: string): Promise<void>;
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

  // SQL Queries (userId-scoped)
  async getSqlQueries(userId?: string): Promise<SqlQuery[]> {
    if (userId) {
      return await db.select().from(sqlQueries)
        .where(or(eq(sqlQueries.userId, userId), isNull(sqlQueries.userId)))
        .orderBy(desc(sqlQueries.updatedAt));
    }
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

  // User Schemas (userId-scoped)
  async getUserSchemas(userId?: string): Promise<UserSchema[]> {
    if (userId) {
      return await db.select().from(userSchemas)
        .where(or(eq(userSchemas.userId, userId), isNull(userSchemas.userId)))
        .orderBy(desc(userSchemas.updatedAt));
    }
    return await db.select().from(userSchemas).orderBy(desc(userSchemas.updatedAt));
  }

  async getUserSchema(id: number): Promise<UserSchema | undefined> {
    const [schema] = await db.select().from(userSchemas).where(eq(userSchemas.id, id));
    return schema;
  }

  async createUserSchema(schema: InsertUserSchema): Promise<UserSchema> {
    const values = {
      ...schema,
      tables: schema.tables ? (schema.tables as Array<{ name: string; columns: string[] }>) : undefined,
    };
    const [created] = await db.insert(userSchemas).values(values).returning();
    return created;
  }

  async updateUserSchema(id: number, schema: UpdateUserSchema): Promise<UserSchema | undefined> {
    const setValues = {
      ...schema,
      tables: schema.tables ? (schema.tables as Array<{ name: string; columns: string[] }>) : undefined,
      updatedAt: new Date(),
    };
    const [updated] = await db
      .update(userSchemas)
      .set(setValues)
      .where(eq(userSchemas.id, id))
      .returning();
    return updated;
  }

  async deleteUserSchema(id: number): Promise<boolean> {
    const result = await db.delete(userSchemas).where(eq(userSchemas.id, id)).returning();
    return result.length > 0;
  }

  // Chat Messages
  async getChatMessages(userId?: string): Promise<ChatMessage[]> {
    if (userId) {
      return await db.select().from(chatMessages)
        .where(eq(chatMessages.userId, userId))
        .orderBy(chatMessages.createdAt);
    }
    return await db.select().from(chatMessages).orderBy(chatMessages.createdAt);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [created] = await db.insert(chatMessages).values(message).returning();
    return created;
  }

  async clearChatMessages(userId?: string): Promise<void> {
    if (userId) {
      await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
    } else {
      await db.delete(chatMessages);
    }
  }
}

export const storage = new DatabaseStorage();
