// LLM model definitions with context window limits for query input

export interface LLMModel {
  id: string;
  name: string;
  provider: string;
  maxQueryChars: number;
  contextTokens: number;
}

export const LLM_MODELS: LLMModel[] = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "Anthropic",
    maxQueryChars: 100_000,
    contextTokens: 200_000,
  },
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    maxQueryChars: 100_000,
    contextTokens: 200_000,
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    maxQueryChars: 100_000,
    contextTokens: 200_000,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    maxQueryChars: 60_000,
    contextTokens: 128_000,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    maxQueryChars: 60_000,
    contextTokens: 128_000,
  },
  {
    id: "gpt-3.5-turbo",
    name: "GPT-3.5 Turbo",
    provider: "OpenAI",
    maxQueryChars: 8_000,
    contextTokens: 16_000,
  },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-4-5";

export function getModelById(id: string): LLMModel | undefined {
  return LLM_MODELS.find((m) => m.id === id);
}

export function getDefaultModel(): LLMModel {
  return LLM_MODELS.find((m) => m.id === DEFAULT_MODEL_ID) || LLM_MODELS[0];
}

// ── SQL Dialect Detection ────────────────────────────────────────────

export type SqlDialect =
  | "PostgreSQL"
  | "MySQL"
  | "T-SQL"
  | "Oracle"
  | "SQLite"
  | "Standard SQL";

interface DialectSignal {
  dialect: SqlDialect;
  weight: number;
  pattern: RegExp;
}

const DIALECT_SIGNALS: DialectSignal[] = [
  // PostgreSQL
  { dialect: "PostgreSQL", weight: 3, pattern: /\bRETURNING\b/i },
  { dialect: "PostgreSQL", weight: 3, pattern: /\bILIKE\b/i },
  { dialect: "PostgreSQL", weight: 4, pattern: /::\s*\w+/  },                  // ::type cast
  { dialect: "PostgreSQL", weight: 3, pattern: /\$\d+/ },                       // $1 params
  { dialect: "PostgreSQL", weight: 3, pattern: /\bON\s+CONFLICT\b/i },
  { dialect: "PostgreSQL", weight: 2, pattern: /\bSERIAL\b/i },
  { dialect: "PostgreSQL", weight: 2, pattern: /\bBIGSERIAL\b/i },
  { dialect: "PostgreSQL", weight: 3, pattern: /\bEXPLAIN\s+ANALYZE\b/i },
  { dialect: "PostgreSQL", weight: 2, pattern: /\bDO\s+UPDATE\b/i },
  { dialect: "PostgreSQL", weight: 2, pattern: /\bARRAY\s*\[/i },
  { dialect: "PostgreSQL", weight: 2, pattern: /\bNOW\s*\(\s*\)/i },
  { dialect: "PostgreSQL", weight: 2, pattern: /\bgenerate_series\b/i },
  { dialect: "PostgreSQL", weight: 2, pattern: /\bstring_agg\b/i },
  { dialect: "PostgreSQL", weight: 3, pattern: /\bJSONB?\b/ },
  { dialect: "PostgreSQL", weight: 2, pattern: /\bCROSS\s+JOIN\s+LATERAL\b/i },

  // MySQL
  { dialect: "MySQL", weight: 4, pattern: /\bAUTO_INCREMENT\b/i },
  { dialect: "MySQL", weight: 3, pattern: /`\w+`/ },                           // backtick identifiers
  { dialect: "MySQL", weight: 3, pattern: /\bIFNULL\s*\(/i },
  { dialect: "MySQL", weight: 3, pattern: /\bENGINE\s*=/i },
  { dialect: "MySQL", weight: 2, pattern: /\bSHOW\s+(TABLES|DATABASES|COLUMNS)\b/i },
  { dialect: "MySQL", weight: 2, pattern: /\bDESCRIBE\b/i },
  { dialect: "MySQL", weight: 2, pattern: /\bLIMIT\s+\d+\s*,\s*\d+/i },       // LIMIT offset,count
  { dialect: "MySQL", weight: 3, pattern: /@@\w+/ },                           // @@variable
  { dialect: "MySQL", weight: 2, pattern: /\bGROUP_CONCAT\s*\(/i },
  { dialect: "MySQL", weight: 2, pattern: /\bSTRAIGHT_JOIN\b/i },
  { dialect: "MySQL", weight: 2, pattern: /\bUSE\s+\w+/i },

  // T-SQL (SQL Server)
  { dialect: "T-SQL", weight: 3, pattern: /\bTOP\s+\d+/i },
  { dialect: "T-SQL", weight: 4, pattern: /\bNOLOCK\b/i },
  { dialect: "T-SQL", weight: 3, pattern: /\bIDENTITY\s*\(/i },
  { dialect: "T-SQL", weight: 3, parameter: "pattern", pattern: /\bNVARCHAR\b/i },
  { dialect: "T-SQL", weight: 4, pattern: /\bGO\s*$/im },
  { dialect: "T-SQL", weight: 3, pattern: /@@IDENTITY/i },
  { dialect: "T-SQL", weight: 3, pattern: /\bSET\s+NOCOUNT\s+ON\b/i },
  { dialect: "T-SQL", weight: 3, pattern: /\bGETDATE\s*\(\s*\)/i },
  { dialect: "T-SQL", weight: 2, pattern: /\bDATEADD\s*\(/i },
  { dialect: "T-SQL", weight: 2, pattern: /\bDATEDIFF\s*\(/i },
  { dialect: "T-SQL", weight: 2, pattern: /\bISNULL\s*\(/i },
  { dialect: "T-SQL", weight: 3, pattern: /\bWITH\s*\(\s*NOLOCK\s*\)/i },
  { dialect: "T-SQL", weight: 2, pattern: /\b(sp|xp)_\w+/i },
  { dialect: "T-SQL", weight: 3, pattern: /\[@\w+\]/ },                        // [bracketed] identifiers
  { dialect: "T-SQL", weight: 2, pattern: /\bOUTPUT\s+INSERTED\b/i },

  // Oracle
  { dialect: "Oracle", weight: 3, pattern: /\bROWNUM\b/i },
  { dialect: "Oracle", weight: 3, pattern: /\bNVL\s*\(/i },
  { dialect: "Oracle", weight: 3, pattern: /\bSYSDATE\b/i },
  { dialect: "Oracle", weight: 4, pattern: /\bFROM\s+DUAL\b/i },
  { dialect: "Oracle", weight: 3, pattern: /\bCONNECT\s+BY\b/i },
  { dialect: "Oracle", weight: 3, pattern: /\bSTART\s+WITH\b/i },
  { dialect: "Oracle", weight: 2, pattern: /\bDECODE\s*\(/i },
  { dialect: "Oracle", weight: 3, pattern: /\bNEXTVAL\b/i },
  { dialect: "Oracle", weight: 2, pattern: /\bDBMS_\w+/i },
  { dialect: "Oracle", weight: 2, pattern: /\bUTL_\w+/i },
  { dialect: "Oracle", weight: 2, pattern: /\bROWID\b/i },
  { dialect: "Oracle", weight: 3, pattern: /\bFETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\b/i },

  // SQLite
  { dialect: "SQLite", weight: 4, pattern: /\bAUTOINCREMENT\b/i },            // one word, not AUTO_INCREMENT
  { dialect: "SQLite", weight: 4, pattern: /\bsqlite_master\b/i },
  { dialect: "SQLite", weight: 3, pattern: /\bPRAGMA\b/i },
  { dialect: "SQLite", weight: 2, parameter: "pattern", pattern: /\bGLOB\b/i },
  { dialect: "SQLite", weight: 2, pattern: /\btypeof\s*\(/i },
] as DialectSignal[];

export function detectSqlDialect(sql: string): SqlDialect {
  if (!sql || sql.trim().length < 5) return "Standard SQL";

  const scores: Record<SqlDialect, number> = {
    "PostgreSQL": 0,
    "MySQL": 0,
    "T-SQL": 0,
    "Oracle": 0,
    "SQLite": 0,
    "Standard SQL": 0,
  };

  for (const signal of DIALECT_SIGNALS) {
    if (signal.pattern.test(sql)) {
      scores[signal.dialect] += signal.weight;
    }
  }

  let bestDialect: SqlDialect = "Standard SQL";
  let bestScore = 0;

  for (const [dialect, score] of Object.entries(scores) as [SqlDialect, number][]) {
    if (score > bestScore) {
      bestScore = score;
      bestDialect = dialect;
    }
  }

  // Require a minimum confidence threshold
  if (bestScore < 2) return "Standard SQL";

  return bestDialect;
}

// Dialect display metadata
export const DIALECT_META: Record<SqlDialect, { color: string; abbrev: string }> = {
  "PostgreSQL": { color: "text-sky-400", abbrev: "PG" },
  "MySQL": { color: "text-orange-400", abbrev: "MySQL" },
  "T-SQL": { color: "text-blue-400", abbrev: "T-SQL" },
  "Oracle": { color: "text-red-400", abbrev: "ORA" },
  "SQLite": { color: "text-emerald-400", abbrev: "SQLite" },
  "Standard SQL": { color: "text-muted-foreground", abbrev: "SQL" },
};
