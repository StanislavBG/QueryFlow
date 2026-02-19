import { db } from "./db";
import {
  documents,
  type CreateDocumentRequest,
  type DocumentResponse
} from "@shared/schema";

export interface IStorage {
  getDocuments(): Promise<DocumentResponse[]>;
  createDocument(doc: CreateDocumentRequest): Promise<DocumentResponse>;
}

export class DatabaseStorage implements IStorage {
  async getDocuments(): Promise<DocumentResponse[]> {
    return await db.select().from(documents);
  }

  async createDocument(insertDoc: CreateDocumentRequest): Promise<DocumentResponse> {
    const [doc] = await db.insert(documents).values(insertDoc).returning();
    return doc;
  }
}

export const storage = new DatabaseStorage();
