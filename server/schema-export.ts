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

// ---------------------------------------------------------------------------
// ERD diagram — deterministic SVG generated from the structured schema data
// (same source of truth as the on-screen ERD). Rendered into the HTML export so
// it is guaranteed faithful: every table, key field, and relationship is drawn
// exactly as defined, with nothing invented.
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtml(s: string): string {
  return escapeXml(s).replace(/'/g, "&#39;");
}

function truncate(s: string, n: number): string {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

interface ErdBox {
  table: ParsedTable;
  keyFields: Array<ParsedColumn & { isFk: boolean }>;
  h: number;
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
}

/** Build a scalable SVG ERD: boxes per table with key fields + relationship lines. */
function buildErdSvg(tables: ParsedTable[], idSuffix: string): string {
  const n = tables.length;
  if (n === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 80"><text x="20" y="45" font-family="sans-serif" font-size="15" fill="#64748b">No tables to diagram</text></svg>`;
  }

  const cols = Math.min(Math.ceil(Math.sqrt(n)), 4);
  const numRows = Math.ceil(n / cols);
  const boxW = 250, gapX = 60, gapY = 55, headerH = 34, rowH = 22, padV = 10, margin = 24;

  const keyFieldsFor = (t: ParsedTable) => {
    const fks = new Set((t.relationships || []).map((r) => (r.fromCol || "").toLowerCase()));
    return t.columns
      .filter((c) => c.isPrimaryKey || fks.has((c.name || "").toLowerCase()))
      .map((c) => ({ ...c, isFk: fks.has((c.name || "").toLowerCase()) }));
  };

  const boxes: ErdBox[] = tables.map((t, i) => {
    const keyFields = keyFieldsFor(t);
    const h = headerH + Math.max(keyFields.length, 1) * rowH + padV;
    return { table: t, keyFields, h, col: i % cols, row: Math.floor(i / cols), x: 0, y: 0, w: boxW };
  });

  const rowHeights: number[] = [];
  for (let r = 0; r < numRows; r++) {
    rowHeights[r] = Math.max(...boxes.filter((b) => b.row === r).map((b) => b.h));
  }
  const rowY: number[] = [];
  let yAcc = margin;
  for (let r = 0; r < numRows; r++) { rowY[r] = yAcc; yAcc += rowHeights[r] + gapY; }
  const totalH = yAcc - gapY + margin;
  const totalW = margin * 2 + cols * boxW + (cols - 1) * gapX;

  boxes.forEach((b) => { b.x = margin + b.col * (boxW + gapX); b.y = rowY[b.row]; });
  const byName = new Map(boxes.map((b) => [b.table.name.toLowerCase(), b]));

  // Point on a box border in the direction of (tx, ty), so lines stop at edges.
  const borderPoint = (b: ErdBox, tx: number, ty: number) => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const s = 1 / Math.max(Math.abs(dx) / (b.w / 2), Math.abs(dy) / (b.h / 2));
    return { x: cx + dx * s, y: cy + dy * s };
  };

  const arrow = `qfArrow${idSuffix}`;
  let lines = "";
  const seen = new Set<string>();
  for (const b of boxes) {
    for (const r of b.table.relationships || []) {
      const tgt = byName.get((r.toTable || "").toLowerCase());
      if (!tgt || tgt === b) continue;
      const key = `${b.table.name}>${r.toTable}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const tc = { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 };
      const p1 = borderPoint(b, tc.x, tc.y);
      const p2 = borderPoint(tgt, sc.x, sc.y);
      lines += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#${arrow})"/>`;
    }
  }

  let boxesSvg = "";
  for (const b of boxes) {
    boxesSvg += `<g>`;
    boxesSvg += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>`;
    boxesSvg += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${headerH}" rx="8" fill="#4f46e5"/>`;
    boxesSvg += `<rect x="${b.x}" y="${b.y + headerH - 9}" width="${b.w}" height="9" fill="#4f46e5"/>`;
    boxesSvg += `<text x="${b.x + b.w / 2}" y="${b.y + 22}" text-anchor="middle" font-size="14" font-weight="700" fill="#ffffff">${escapeXml(truncate(b.table.name, 26))}</text>`;
    if (b.keyFields.length === 0) {
      boxesSvg += `<text x="${b.x + 12}" y="${b.y + headerH + 18}" font-size="12" fill="#94a3b8" font-style="italic">(no key fields)</text>`;
    } else {
      b.keyFields.forEach((c, idx) => {
        const fy = b.y + headerH + padV + idx * rowH + 13;
        const marker = c.isPrimaryKey && c.isFk ? "PK·FK" : c.isPrimaryKey ? "PK" : "FK";
        const color = c.isPrimaryKey ? "#b45309" : "#1d4ed8";
        boxesSvg += `<text x="${b.x + 12}" y="${fy}" font-family="ui-monospace,monospace" font-size="12" fill="#0f172a">${escapeXml(truncate(c.name, 20))}</text>`;
        boxesSvg += `<text x="${b.x + b.w - 12}" y="${fy}" text-anchor="end" font-size="10" font-weight="700" fill="${color}">${marker}</text>`;
      });
    }
    boxesSvg += `</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(0)} ${totalH.toFixed(0)}" font-family="ui-sans-serif,system-ui,sans-serif">`
    + `<defs><marker id="${arrow}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker></defs>`
    + lines + boxesSvg + `</svg>`;
}

/**
 * Build the ERD section (HTML) injected into the LLM-curated overview: a
 * full-page diagram sized as large as possible, plus a 16:9 "slide" version of
 * the same diagram. Both list each table's key fields and relationships.
 */
export function buildSchemaErdHtml(schema: UserSchema): string {
  const tables = normalizeTables(schema.tables);
  const svgFull = buildErdSvg(tables, "Full");
  const svgSlide = buildErdSvg(tables, "Slide");
  const name = escapeHtml(schema.name);

  return `
<section class="qf-erd">
  <style>
    .qf-erd{margin:2.5rem 0;font-family:ui-sans-serif,system-ui,sans-serif;}
    .qf-erd h2{font-size:1.4rem;margin:0 0 .25rem;}
    .qf-erd .qf-erd-note{color:#64748b;font-size:.85rem;margin:0 0 1rem;}
    .qf-erd-full{width:100%;border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc;box-sizing:border-box;}
    .qf-erd-full svg{width:100%;height:auto;display:block;}
    .qf-erd-legend{font-size:.8rem;color:#475569;margin-top:.6rem;}
    .qf-erd-legend .pk{color:#b45309;font-weight:700;} .qf-erd-legend .fk{color:#1d4ed8;font-weight:700;}
    .qf-erd-slide-wrap{margin-top:1.75rem;}
    .qf-erd-slide{width:100%;aspect-ratio:16/9;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;box-shadow:0 6px 20px rgba(2,6,23,.08);padding:18px 22px;box-sizing:border-box;display:flex;flex-direction:column;}
    .qf-erd-slide .qf-slide-title{font-size:1.1rem;font-weight:700;margin:0 0 .5rem;color:#1e293b;}
    .qf-erd-slide .qf-slide-canvas{flex:1;min-height:0;}
    .qf-erd-slide svg{width:100%;height:100%;display:block;}
    @media print{
      .qf-erd-full{page-break-before:always;page-break-inside:avoid;}
      .qf-erd-slide-wrap{page-break-before:always;page-break-inside:avoid;}
    }
  </style>
  <h2>Entity-Relationship Diagram</h2>
  <p class="qf-erd-note">Each table is shown with its key fields and relationships, generated directly from the schema definition.</p>
  <div class="qf-erd-full">${svgFull}</div>
  <div class="qf-erd-legend"><span class="pk">PK</span> = primary key &nbsp;&middot;&nbsp; <span class="fk">FK</span> = foreign key &nbsp;&middot;&nbsp; arrows point to referenced tables</div>
  <div class="qf-erd-slide-wrap">
    <div class="qf-erd-slide">
      <div class="qf-slide-title">${name} &mdash; Schema ERD</div>
      <div class="qf-slide-canvas">${svgSlide}</div>
    </div>
  </div>
</section>`;
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
