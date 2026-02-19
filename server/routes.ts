import type { Express } from "express";
import type { Server } from "http";
import { clerkMiddleware } from "@clerk/express";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(clerkMiddleware({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  }));

  app.get(api.documents.list.path, async (req, res) => {
    const docs = await storage.getDocuments();
    res.json(docs);
  });

  app.post(api.documents.create.path, async (req, res) => {
    try {
      const input = api.documents.create.input.parse(req.body);
      const doc = await storage.createDocument(input);
      res.status(201).json(doc);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Seed database
  storage.getDocuments().then(async (docs) => {
    if (docs.length === 0) {
      await storage.createDocument({ content: "Hello, World!", contentType: "text" });
      await storage.createDocument({ content: '{"message": "Hello World"}', contentType: "json" });
      await storage.createDocument({ content: "# Hello World\n\nThis is markdown.", contentType: "md" });
    }
  }).catch(console.error);

  return httpServer;
}
