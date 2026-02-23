import { db } from "./db";
import { eq, desc, and, isNull, or, sql, count } from "drizzle-orm";
import {
  documents,
  sqlQueries,
  queryFeedback,
  agentSettings,
  userSchemas,
  chatMessages,
  appUsers,
  activityEvents,
  schemaVoiceContext,
  demoVersions,
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
  type AppUser,
  type InsertAppUser,
  type ActivityEvent,
  type InsertActivityEvent,
  type ParsedTable,
  type SchemaVoiceContext,
  type InsertSchemaVoiceContext,
  type DemoVersion,
  type InsertDemoVersion,
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
  dismissFeedback(id: number): Promise<QueryFeedbackRow | undefined>;

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

  // App Users (RBAC)
  getAppUserByClerkId(clerkId: string): Promise<AppUser | undefined>;
  upsertAppUser(user: InsertAppUser): Promise<AppUser>;
  getAllAppUsers(): Promise<AppUser[]>;
  touchUserActivity(clerkId: string): Promise<void>;

  // Activity Events
  logActivity(event: InsertActivityEvent): Promise<ActivityEvent>;
  getActivityEvents(opts?: { userId?: string; limit?: number; offset?: number }): Promise<ActivityEvent[]>;
  getActivityCount(userId?: string): Promise<number>;
  getActivityEventsByAction(action: string, since?: Date): Promise<ActivityEvent[]>;

  // Schema Voice Context
  getSchemaVoiceContexts(schemaId: number): Promise<SchemaVoiceContext[]>;
  upsertSchemaVoiceContext(data: InsertSchemaVoiceContext): Promise<SchemaVoiceContext>;
  deleteSchemaVoiceContext(id: number): Promise<boolean>;

  // Demo Versions
  getDemoVersions(): Promise<DemoVersion[]>;
  getDemoVersionCount(): Promise<number>;
  getRandomDemoVersion(): Promise<DemoVersion | undefined>;
  createDemoVersion(data: InsertDemoVersion): Promise<DemoVersion>;
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
    draftContent: decrypt(row.draftContent, aad),
    formattedContent: decrypt(row.formattedContent, aad),
    waterfallData: row.waterfallData
      ? (decryptJson<SqlQuery["waterfallData"]>(row.waterfallData, aad) ?? null)
      : null,
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
    tables: decryptJson<ParsedTable[]>(row.tables, aad) ?? [],
  };
}

function decryptChatMessage(row: ChatMessage): ChatMessage {
  return { ...row, content: decrypt(row.content, row.userId) ?? "" };
}

function decryptSchemaVoiceContext(row: SchemaVoiceContext): SchemaVoiceContext {
  return { ...row, transcript: decrypt(row.transcript, row.userId) ?? "" };
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
    if (!userId) {
      // Non-authenticated users see nothing — demo data is virtual, not stored
      return [];
    }
    const rows = await db.select().from(sqlQueries)
      .where(eq(sqlQueries.userId, userId))
      .orderBy(desc(sqlQueries.updatedAt));
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
      draftContent: encrypt(query.draftContent, aad) ?? undefined,
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
    if (query.draftContent !== undefined) encrypted.draftContent = query.draftContent === null ? null : encrypt(query.draftContent, aad);
    if (query.formattedContent !== undefined) encrypted.formattedContent = encrypt(query.formattedContent, aad);
    if ((query as Record<string, unknown>).waterfallData !== undefined) {
      const wf = (query as Record<string, unknown>).waterfallData;
      encrypted.waterfallData = wf ? encryptJson(wf, aad) : null;
    }
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

  async dismissFeedback(id: number): Promise<QueryFeedbackRow | undefined> {
    const [updated] = await db
      .update(queryFeedback)
      .set({ isResolved: true, isDismissed: true })
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
    if (!userId) {
      // Non-authenticated users see nothing — demo schemas are virtual, not stored
      return [];
    }
    const rows = await db.select().from(userSchemas)
      .where(eq(userSchemas.userId, userId))
      .orderBy(desc(userSchemas.updatedAt));
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
        ? (encryptJson(schema.tables, aad) as unknown as ParsedTable[])
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

  // App Users (RBAC)
  async getAppUserByClerkId(clerkId: string): Promise<AppUser | undefined> {
    const [user] = await db.select().from(appUsers).where(eq(appUsers.clerkId, clerkId));
    return user;
  }

  async upsertAppUser(user: InsertAppUser): Promise<AppUser> {
    const existing = await this.getAppUserByClerkId(user.clerkId);
    if (existing) {
      const [updated] = await db
        .update(appUsers)
        .set({ email: user.email, displayName: user.displayName, lastActive: new Date() })
        .where(eq(appUsers.clerkId, user.clerkId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(appUsers).values(user).returning();
    return created;
  }

  async getAllAppUsers(): Promise<AppUser[]> {
    return await db.select().from(appUsers).orderBy(desc(appUsers.lastActive));
  }

  async touchUserActivity(clerkId: string): Promise<void> {
    await db
      .update(appUsers)
      .set({ lastActive: new Date() })
      .where(eq(appUsers.clerkId, clerkId));
  }

  // Activity Events
  async logActivity(event: InsertActivityEvent): Promise<ActivityEvent> {
    const [created] = await db.insert(activityEvents).values(event).returning();
    return created;
  }

  async getActivityEvents(opts?: { userId?: string; limit?: number; offset?: number }): Promise<ActivityEvent[]> {
    const limit = opts?.limit ?? 200;
    const offset = opts?.offset ?? 0;
    if (opts?.userId) {
      return await db.select().from(activityEvents)
        .where(eq(activityEvents.userId, opts.userId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(limit).offset(offset);
    }
    return await db.select().from(activityEvents)
      .orderBy(desc(activityEvents.createdAt))
      .limit(limit).offset(offset);
  }

  async getActivityCount(userId?: string): Promise<number> {
    if (userId) {
      const [result] = await db.select({ count: count() }).from(activityEvents)
        .where(eq(activityEvents.userId, userId));
      return result?.count ?? 0;
    }
    const [result] = await db.select({ count: count() }).from(activityEvents);
    return result?.count ?? 0;
  }

  async getActivityEventsByAction(action: string, since?: Date): Promise<ActivityEvent[]> {
    if (since) {
      return await db.select().from(activityEvents)
        .where(and(eq(activityEvents.action, action), sql`${activityEvents.createdAt} >= ${since}`))
        .orderBy(desc(activityEvents.createdAt));
    }
    return await db.select().from(activityEvents)
      .where(eq(activityEvents.action, action))
      .orderBy(desc(activityEvents.createdAt));
  }

  // Schema Voice Context
  async getSchemaVoiceContexts(schemaId: number): Promise<SchemaVoiceContext[]> {
    const rows = await db.select().from(schemaVoiceContext)
      .where(eq(schemaVoiceContext.schemaId, schemaId));
    return rows.map(decryptSchemaVoiceContext);
  }

  async upsertSchemaVoiceContext(data: InsertSchemaVoiceContext): Promise<SchemaVoiceContext> {
    const aad = data.userId;
    // Find existing row by composite key
    const conditions = [
      eq(schemaVoiceContext.schemaId, data.schemaId),
      eq(schemaVoiceContext.targetType, data.targetType),
    ];
    if (data.targetTable) {
      conditions.push(eq(schemaVoiceContext.targetTable, data.targetTable));
    } else {
      conditions.push(isNull(schemaVoiceContext.targetTable));
    }
    if (data.targetColumn) {
      conditions.push(eq(schemaVoiceContext.targetColumn, data.targetColumn));
    } else {
      conditions.push(isNull(schemaVoiceContext.targetColumn));
    }

    const [existing] = await db.select().from(schemaVoiceContext).where(and(...conditions));

    const encryptedTranscript = encrypt(data.transcript ?? "", aad) ?? "";

    if (existing) {
      const [updated] = await db
        .update(schemaVoiceContext)
        .set({ transcript: encryptedTranscript, updatedAt: new Date() })
        .where(eq(schemaVoiceContext.id, existing.id))
        .returning();
      return decryptSchemaVoiceContext(updated);
    }

    const encrypted = {
      ...data,
      transcript: encryptedTranscript,
    };
    const [created] = await db.insert(schemaVoiceContext).values(encrypted).returning();
    return decryptSchemaVoiceContext(created);
  }

  async deleteSchemaVoiceContext(id: number): Promise<boolean> {
    const result = await db.delete(schemaVoiceContext).where(eq(schemaVoiceContext.id, id)).returning();
    return result.length > 0;
  }

  // Demo Versions
  async getDemoVersions(): Promise<DemoVersion[]> {
    return await db.select().from(demoVersions).orderBy(desc(demoVersions.createdAt));
  }

  async getDemoVersionCount(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(demoVersions);
    return result?.count ?? 0;
  }

  async getRandomDemoVersion(): Promise<DemoVersion | undefined> {
    const [row] = await db.select().from(demoVersions).orderBy(sql`RANDOM()`).limit(1);
    return row;
  }

  async createDemoVersion(data: InsertDemoVersion): Promise<DemoVersion> {
    const [created] = await db.insert(demoVersions).values(data).returning();
    return created;
  }

  async deleteAllDemoVersions(): Promise<number> {
    const result = await db.delete(demoVersions).returning();
    return result.length;
  }
}

export const storage = new DatabaseStorage();
