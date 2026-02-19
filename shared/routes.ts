import { z } from 'zod';
import {
  insertDocumentSchema,
  documents,
  insertSqlQuerySchema,
  updateSqlQuerySchema,
  sqlQueries,
  queryFeedback,
  agentSettings,
  formattingRules,
  updateAgentSettingsSchema,
  updateFormattingRuleSchema,
} from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  documents: {
    list: {
      method: 'GET' as const,
      path: '/api/documents' as const,
      responses: {
        200: z.array(z.custom<typeof documents.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/documents' as const,
      input: insertDocumentSchema,
      responses: {
        201: z.custom<typeof documents.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },

  sqlQueries: {
    list: {
      method: 'GET' as const,
      path: '/api/sql-queries' as const,
      responses: {
        200: z.array(z.custom<typeof sqlQueries.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/sql-queries/:id' as const,
      responses: {
        200: z.custom<typeof sqlQueries.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/sql-queries' as const,
      input: insertSqlQuerySchema,
      responses: {
        201: z.custom<typeof sqlQueries.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/sql-queries/:id' as const,
      input: updateSqlQuerySchema,
      responses: {
        200: z.custom<typeof sqlQueries.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/sql-queries/:id' as const,
      responses: {
        200: z.object({ message: z.string() }),
        404: errorSchemas.notFound,
      },
    },
  },

  feedback: {
    listByQuery: {
      method: 'GET' as const,
      path: '/api/sql-queries/:id/feedback' as const,
      responses: {
        200: z.array(z.custom<typeof queryFeedback.$inferSelect>()),
      },
    },
    analyze: {
      method: 'POST' as const,
      path: '/api/sql-queries/:id/analyze' as const,
      responses: {
        200: z.array(z.custom<typeof queryFeedback.$inferSelect>()),
        404: errorSchemas.notFound,
      },
    },
    resolve: {
      method: 'PATCH' as const,
      path: '/api/feedback/:id/resolve' as const,
      responses: {
        200: z.custom<typeof queryFeedback.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },

  format: {
    formatQuery: {
      method: 'POST' as const,
      path: '/api/format' as const,
      input: z.object({ sql: z.string() }),
      responses: {
        200: z.object({ formatted: z.string() }),
        400: errorSchemas.validation,
      },
    },
  },

  agentSettings: {
    list: {
      method: 'GET' as const,
      path: '/api/agent-settings' as const,
      responses: {
        200: z.array(z.custom<typeof agentSettings.$inferSelect>()),
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/agent-settings/:agentType' as const,
      input: updateAgentSettingsSchema,
      responses: {
        200: z.custom<typeof agentSettings.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },

  formattingRules: {
    list: {
      method: 'GET' as const,
      path: '/api/formatting-rules' as const,
      responses: {
        200: z.array(z.custom<typeof formattingRules.$inferSelect>()),
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/formatting-rules/:name' as const,
      input: updateFormattingRuleSchema,
      responses: {
        200: z.custom<typeof formattingRules.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type DocumentInput = z.infer<typeof api.documents.create.input>;
export type DocumentResponse = z.infer<typeof api.documents.create.responses[201]>;
export type DocumentsListResponse = z.infer<typeof api.documents.list.responses[200]>;
export type ValidationError = z.infer<typeof errorSchemas.validation>;
