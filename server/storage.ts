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
import { encrypt, decrypt, encryptJson, decryptJson } from "./encryption";

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
  deleteFeedbackById(id: number): Promise<void>;
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

// ---------------------------------------------------------------------------
// Decrypt helpers – convert DB rows back to plaintext for the application layer
// ---------------------------------------------------------------------------

function decryptDocument(row: DocumentResponse): DocumentResponse {
  return { ...row, content: decrypt(row.content) ?? "" };
}

function decryptSqlQuery(row: SqlQuery): SqlQuery {
  const aad = row.userId;
  return {
    ...row,
    title: decrypt(row.title, aad) ?? "Untitled Query",
    content: decrypt(row.content, aad) ?? "",
    formattedContent: decrypt(row.formattedContent, aad),
  };
}

function decryptFeedback(row: QueryFeedbackRow): QueryFeedbackRow {
  return {
    ...row,
    title: decrypt(row.title) ?? "",
    message: decrypt(row.message) ?? "",
    suggestion: decrypt(row.suggestion),
  };
}

function decryptUserSchema(row: UserSchema): UserSchema {
  const aad = row.userId;
  return {
    ...row,
    name: decrypt(row.name, aad) ?? "",
    rawContent: decrypt(row.rawContent, aad) ?? "",
    parsedDdl: decrypt(row.parsedDdl, aad) ?? "",
    description: decrypt(row.description, aad),
    fileName: decrypt(row.fileName, aad),
    tables: decryptJson<Array<{ name: string; columns: string[] }>>(row.tables, aad) ?? [],
  };
}

function decryptChatMessage(row: ChatMessage): ChatMessage {
  return { ...row, content: decrypt(row.content, row.userId) ?? "" };
}

export class DatabaseStorage implements IStorage {
  // Documents
  async getDocuments(): Promise<DocumentResponse[]> {
    const rows = await db.select().from(documents);
    return rows.map(decryptDocument);
  }

  async createDocument(insertDoc: CreateDocumentRequest): Promise<DocumentResponse> {
    const encrypted = {
      ...insertDoc,
      content: encrypt(insertDoc.content) ?? "",
    };
    const [doc] = await db.insert(documents).values(encrypted).returning();
    return decryptDocument(doc);
  }

  // SQL Queries (userId-scoped)
  async getSqlQueries(userId?: string): Promise<SqlQuery[]> {
    let rows: SqlQuery[];
    if (userId) {
      rows = await db.select().from(sqlQueries)
        .where(or(eq(sqlQueries.userId, userId), isNull(sqlQueries.userId)))
        .orderBy(desc(sqlQueries.updatedAt));
    } else {
      rows = await db.select().from(sqlQueries).orderBy(desc(sqlQueries.updatedAt));
    }
    return rows.map(decryptSqlQuery);
  }

  async getSqlQuery(id: number): Promise<SqlQuery | undefined> {
    const [query] = await db.select().from(sqlQueries).where(eq(sqlQueries.id, id));
    return query ? decryptSqlQuery(query) : undefined;
  }

  async createSqlQuery(query: InsertSqlQuery): Promise<SqlQuery> {
    const aad = query.userId;
    const encrypted = {
      ...query,
      title: encrypt(query.title ?? "Untitled Query", aad) ?? "",
      content: encrypt(query.content ?? "", aad) ?? "",
      formattedContent: encrypt(query.formattedContent, aad) ?? undefined,
    };
    const [created] = await db.insert(sqlQueries).values(encrypted).returning();
    return decryptSqlQuery(created);
  }

  async updateSqlQuery(id: number, query: UpdateSqlQuery): Promise<SqlQuery | undefined> {
    // Fetch existing row to get userId for AAD binding
    const existing = await this.getSqlQuery(id);
    const aad = query.userId ?? existing?.userId;
    const encrypted: Record<string, unknown> = { updatedAt: new Date() };
    if (query.title !== undefined) encrypted.title = encrypt(query.title, aad);
    if (query.content !== undefined) encrypted.content = encrypt(query.content, aad);
    if (query.formattedContent !== undefined) encrypted.formattedContent = encrypt(query.formattedContent, aad);
    if (query.userId !== undefined) encrypted.userId = query.userId;

    const [updated] = await db
      .update(sqlQueries)
      .set(encrypted)
      .where(eq(sqlQueries.id, id))
      .returning();
    return updated ? decryptSqlQuery(updated) : undefined;
  }

  async deleteSqlQuery(id: number): Promise<boolean> {
    // Delete associated feedback first
    await db.delete(queryFeedback).where(eq(queryFeedback.queryId, id));
    const result = await db.delete(sqlQueries).where(eq(sqlQueries.id, id)).returning();
    return result.length > 0;
  }

  // Feedback
  async getFeedbackByQueryId(queryId: number): Promise<QueryFeedbackRow[]> {
    const rows = await db.select().from(queryFeedback).where(eq(queryFeedback.queryId, queryId));
    return rows.map(decryptFeedback);
  }

  async createFeedback(feedback: InsertFeedback): Promise<QueryFeedbackRow> {
    const encrypted = {
      ...feedback,
      title: encrypt(feedback.title) ?? "",
      message: encrypt(feedback.message) ?? "",
      suggestion: encrypt(feedback.suggestion),
    };
    const [created] = await db.insert(queryFeedback).values(encrypted).returning();
    return decryptFeedback(created);
  }

  async createFeedbackBatch(items: InsertFeedback[]): Promise<QueryFeedbackRow[]> {
    if (items.length === 0) return [];
    const encrypted = items.map((item) => ({
      ...item,
      title: encrypt(item.title) ?? "",
      message: encrypt(item.message) ?? "",
      suggestion: encrypt(item.suggestion),
    }));
    const rows = await db.insert(queryFeedback).values(encrypted).returning();
    return rows.map(decryptFeedback);
  }

  async deleteFeedbackById(id: number): Promise<void> {
    await db.delete(queryFeedback).where(eq(queryFeedback.id, id));
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
    return updated ? decryptFeedback(updated) : undefined;
  }

  // Agent Settings (system config, not user data – no encryption needed)
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
    let rows: UserSchema[];
    if (userId) {
      rows = await db.select().from(userSchemas)
        .where(or(eq(userSchemas.userId, userId), isNull(userSchemas.userId)))
        .orderBy(desc(userSchemas.updatedAt));
    } else {
      rows = await db.select().from(userSchemas).orderBy(desc(userSchemas.updatedAt));
    }
    return rows.map(decryptUserSchema);
  }

  async getUserSchema(id: number): Promise<UserSchema | undefined> {
    const [schema] = await db.select().from(userSchemas).where(eq(userSchemas.id, id));
    return schema ? decryptUserSchema(schema) : undefined;
  }

  async createUserSchema(schema: InsertUserSchema): Promise<UserSchema> {
    const aad = schema.userId;
    const encrypted = {
      ...schema,
      name: encrypt(schema.name, aad) ?? "",
      rawContent: encrypt(schema.rawContent, aad) ?? "",
      parsedDdl: encrypt(schema.parsedDdl ?? "", aad) ?? undefined,
      description: encrypt(schema.description, aad) ?? undefined,
      fileName: encrypt(schema.fileName, aad) ?? undefined,
      tables: schema.tables
        ? (encryptJson(schema.tables, aad) as unknown as Array<{ name: string; columns: string[] }>)
        : undefined,
    };
    const [created] = await db.insert(userSchemas).values(encrypted).returning();
    return decryptUserSchema(created);
  }

  async updateUserSchema(id: number, schema: UpdateUserSchema): Promise<UserSchema | undefined> {
    // Fetch existing row to get userId for AAD binding
    const existing = await this.getUserSchema(id);
    const aad = schema.userId ?? existing?.userId;
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (schema.name !== undefined) setValues.name = encrypt(schema.name, aad);
    if (schema.rawContent !== undefined) setValues.rawContent = encrypt(schema.rawContent, aad);
    if (schema.parsedDdl !== undefined) setValues.parsedDdl = encrypt(schema.parsedDdl, aad);
    if (schema.description !== undefined) setValues.description = encrypt(schema.description, aad);
    if (schema.fileName !== undefined) setValues.fileName = encrypt(schema.fileName, aad);
    if (schema.userId !== undefined) setValues.userId = schema.userId;
    if (schema.tables !== undefined) {
      setValues.tables = encryptJson(schema.tables, aad);
    }

    const [updated] = await db
      .update(userSchemas)
      .set(setValues)
      .where(eq(userSchemas.id, id))
      .returning();
    return updated ? decryptUserSchema(updated) : undefined;
  }

  async deleteUserSchema(id: number): Promise<boolean> {
    const result = await db.delete(userSchemas).where(eq(userSchemas.id, id)).returning();
    return result.length > 0;
  }

  // Chat Messages
  async getChatMessages(userId?: string): Promise<ChatMessage[]> {
    let rows: ChatMessage[];
    if (userId) {
      rows = await db.select().from(chatMessages)
        .where(eq(chatMessages.userId, userId))
        .orderBy(chatMessages.createdAt);
    } else {
      rows = await db.select().from(chatMessages).orderBy(chatMessages.createdAt);
    }
    return rows.map(decryptChatMessage);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const encrypted = {
      ...message,
      content: encrypt(message.content, message.userId) ?? "",
    };
    const [created] = await db.insert(chatMessages).values(encrypted).returning();
    return decryptChatMessage(created);
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
