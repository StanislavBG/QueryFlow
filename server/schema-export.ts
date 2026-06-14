// ---------------------------------------------------------------------------
// Schema export — deterministic serialization of already-parsed schema data
// into portable, human-verifiable artifacts (Markdown + SQL DDL).
//
// IMPORTANT: This module does NOT parse or infer anything. All "intelligent"
// work (turning raw DDL/DESCRIBE text into structured tables, types, primary
// keys, and relationships) already happened via the LLM at upload time. Here
// we only render that existing structured data 1:1, which keeps the output
// deterministic and verifiable — a hard requirement for analysts who compare
// exports character-by-character.
// ---------------------------------------------------------------------------

import type { UserSchema, ParsedTable, ParsedColumn, SchemaVoiceContext } from "@shared/schema";

export type ExportFormat = "md" | "sql";

/** Light shape-normalizer mirroring the client's normalizeTables (no parsing). */
function normalizeTables(tables: unknown): ParsedTable[] {
  if (!Array.isArray(tables)) return [];
  return tables.map((t: any) => {
    if (!t || !t.name || !Array.isArray(t.columns)) {
      return { name: t?.name || "unknown", columns: [], relationships: [] };
    }
    // Legacy format: columns stored as plain strings
    if (t.columns.length > 0 && typeof t.columns[0] === "string") {
      return {
        name: t.name,
        ...(typeof t.context === "string" && t.context.trim() ? { context: t.context.trim() } : {}),
        columns: t.columns.map((c: string) => ({ name: c, type: "", isPrimaryKey: false })),
        relationships: [],
      };
    }
    return {
      name: t.name,
      ...(typeof t.context === "string" && t.context.trim() ? { context: t.context.trim() } : {}),
      columns: t.columns.map((c: any) => ({
        name: c?.name || "",
        type: c?.type || "",
        isPrimaryKey: !!c?.isPrimaryKey,
        ...(typeof c?.context === "string" && c.context.trim() ? { context: c.context.trim() } : {}),
      })),
      relationships: Array.isArray(t.relationships)
        ? t.relationships.map((r: any) => ({
            fromCol: r?.fromCol || "",
            toTable: r?.toTable || "",
            toCol: r?.toCol || "",
          }))
        : [],
    };
  });
}

/** Find a voice-context annotation for a given target. */
function findVoice(
  contexts: SchemaVoiceContext[],
  targetType: "schema" | "table" | "column",
  targetTable?: string,
  targetColumn?: string,
): string | undefined {
  const match = contexts.find(
    (c) =>
      c.targetType === targetType &&
      (c.targetTable ?? null) === (targetTable ?? null) &&
      (c.targetColumn ?? null) === (targetColumn ?? null),
  );
  const t = match?.transcript?.trim();
  return t ? t : undefined;
}

/** Slugify a schema name into a safe file base name. */
export function exportFileBase(name: string): string {
  const slug = (name || "schema")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "schema";
}

/** Render every line of `text` as a SQL comment, indented under `prefix`. */
function sqlComment(text: string, prefix = "-- "): string {
  return text
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`.trimEnd())
    .join("\n");
}

// ---------------------------------------------------------------------------
// SQL DDL export — runnable CREATE TABLE statements + descriptions as comments.
// Identifiers are left unquoted to maximize portability across SQL engines.
// ---------------------------------------------------------------------------

export function buildSchemaSql(
  schema: UserSchema,
  voiceContexts: SchemaVoiceContext[],
  exportedAt: Date,
): string {
  const tables = normalizeTables(schema.tables);
  const lines: string[] = [];

  lines.push("-- =====================================================================");
  lines.push(`-- Schema: ${schema.name}`);
  lines.push(`-- Exported from QueryFlow on ${exportedAt.toISOString()}`);
  lines.push(`-- Tables: ${tables.length}`);
  lines.push("-- =====================================================================");

  const schemaDesc = (schema.description ?? "").trim();
  if (schemaDesc) {
    lines.push("--");
    lines.push(sqlComment(schemaDesc, "-- "));
  }
  const schemaVoice = findVoice(voiceContexts, "schema");
  if (schemaVoice) {
    lines.push("--");
    lines.push("-- Schema notes:");
    lines.push(sqlComment(schemaVoice, "--   "));
  }
  lines.push("");

  for (const table of tables) {
    lines.push("-- ---------------------------------------------------------------------");
    lines.push(`-- Table: ${table.name}`);
    if (table.context?.trim()) lines.push(sqlComment(table.context.trim(), "--   "));
    const tableVoice = findVoice(voiceContexts, "table", table.name);
    if (tableVoice) {
      lines.push("-- Notes:");
      lines.push(sqlComment(tableVoice, "--     "));
    }
    lines.push("-- ---------------------------------------------------------------------");

    const pkCols = table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

    lines.push(`CREATE TABLE ${table.name} (`);
    const colDefs: string[] = [];
    table.columns.forEach((col) => {
      const colVoice = findVoice(voiceContexts, "column", table.name, col.name);
      // Emit context/notes as comment lines immediately above the column.
      if (col.context?.trim()) colDefs.push(sqlComment(col.context.trim(), "  -- "));
      if (colVoice) colDefs.push(sqlComment(`note: ${colVoice}`, "  -- "));

      const type = col.type?.trim() || "varchar(255)";
      const notNull = col.isPrimaryKey ? " NOT NULL" : "";
      colDefs.push(`  ${col.name} ${type}${notNull},`);
    });

    if (pkCols.length > 0) {
      colDefs.push(`  PRIMARY KEY (${pkCols.join(", ")})`);
    } else if (colDefs.length > 0) {
      // Strip trailing comma from the last column definition line.
      for (let i = colDefs.length - 1; i >= 0; i--) {
        if (!colDefs[i].trimStart().startsWith("--")) {
          colDefs[i] = colDefs[i].replace(/,\s*$/, "");
          break;
        }
      }
    }
    lines.push(colDefs.join("\n"));
    lines.push(");");
    lines.push("");
  }

  // Foreign-key relationships (rendered after all tables so targets exist).
  const fkStatements: string[] = [];
  for (const table of tables) {
    for (const rel of table.relationships ?? []) {
      if (!rel.fromCol || !rel.toTable || !rel.toCol) continue;
      fkStatements.push(
        `ALTER TABLE ${table.name} ADD FOREIGN KEY (${rel.fromCol}) REFERENCES ${rel.toTable}(${rel.toCol});`,
      );
    }
  }
  if (fkStatements.length > 0) {
    lines.push("-- ---------------------------------------------------------------------");
    lines.push("-- Relationships (foreign keys)");
    lines.push("-- ---------------------------------------------------------------------");
    lines.push(...fkStatements);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Markdown export — full human-readable schema documentation.
// ---------------------------------------------------------------------------

function mdEscapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

export function buildSchemaMarkdown(
  schema: UserSchema,
  voiceContexts: SchemaVoiceContext[],
  exportedAt: Date,
): string {
  const tables = normalizeTables(schema.tables);
  const lines: string[] = [];

  lines.push(`# Schema: ${schema.name}`);
  lines.push("");
  lines.push(`> Exported from QueryFlow on ${exportedAt.toISOString()}`);
  lines.push("");

  const schemaDesc = (schema.description ?? "").trim();
  if (schemaDesc) {
    lines.push(`**Description:** ${schemaDesc}`);
    lines.push("");
  }
  const schemaVoice = findVoice(voiceContexts, "schema");
  if (schemaVoice) {
    lines.push(`**Schema notes:** ${schemaVoice}`);
    lines.push("");
  }
  lines.push(`**Tables:** ${tables.length}`);
  lines.push("");

  if (tables.length > 0) {
    lines.push("## Contents");
    lines.push("");
    for (const table of tables) {
      lines.push(`- [${table.name}](#${table.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}) — ${table.columns.length} column${table.columns.length !== 1 ? "s" : ""}`);
    }
    lines.push("");
  }

  for (const table of tables) {
    lines.push("---");
    lines.push("");
    lines.push(`## ${table.name}`);
    lines.push("");
    if (table.context?.trim()) {
      lines.push(`> ${table.context.trim().replace(/\r?\n/g, " ")}`);
      lines.push("");
    }
    const tableVoice = findVoice(voiceContexts, "table", table.name);
    if (tableVoice) {
      lines.push(`**Notes:** ${tableVoice.replace(/\r?\n/g, " ")}`);
      lines.push("");
    }

    // Column table
    lines.push("| Column | Type | Key | Description |");
    lines.push("| --- | --- | --- | --- |");
    for (const col of table.columns) {
      const colVoice = findVoice(voiceContexts, "column", table.name, col.name);
      const descParts = [col.context?.trim(), colVoice ? `Note: ${colVoice}` : ""].filter(Boolean) as string[];
      const key = col.isPrimaryKey ? "PK" : "";
      lines.push(
        `| \`${col.name}\` | ${mdEscapeCell(col.type || "")} | ${key} | ${mdEscapeCell(descParts.join(" — "))} |`,
      );
    }
    lines.push("");

    // Relationships
    const outgoing = (table.relationships ?? []).filter((r) => r.fromCol && r.toTable && r.toCol);
    if (outgoing.length > 0) {
      lines.push("### Relationships");
      lines.push("");
      for (const rel of outgoing) {
        lines.push(`- \`${rel.fromCol}\` → \`${rel.toTable}.${rel.toCol}\``);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** Build the export payload (content + filename + content-type) for a format. */
export function buildSchemaExport(
  schema: UserSchema,
  voiceContexts: SchemaVoiceContext[],
  format: ExportFormat,
  exportedAt: Date = new Date(),
): { content: string; filename: string; contentType: string } {
  const base = exportFileBase(schema.name);
  if (format === "sql") {
    return {
      content: buildSchemaSql(schema, voiceContexts, exportedAt),
      filename: `${base}.sql`,
      contentType: "application/sql; charset=utf-8",
    };
  }
  return {
    content: buildSchemaMarkdown(schema, voiceContexts, exportedAt),
    filename: `${base}.md`,
    contentType: "text/markdown; charset=utf-8",
  };
}
