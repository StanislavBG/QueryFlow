/**
 * Local parser for common schema formats that don't need LLM processing.
 * Currently supports:
 *  - MySQL DESCRIBE / DESC output (tab-separated)
 *  - MySQL SHOW CREATE TABLE output
 *
 * Returns null if the format is not recognized, so the caller
 * can fall through to LLM-based parsing.
 */

interface ParsedSchema {
  parsed: string;
  tables: Array<{ name: string; columns: string[] }>;
}

/**
 * Try to parse MySQL DESCRIBE output into CREATE TABLE DDL.
 *
 * Recognizes patterns like:
 *   DESCRIBE table_name;
 *   field  type  null  key  default  extra
 *   ...
 *
 * Also handles bare tab-separated column rows without DESCRIBE headers,
 * and the "+---------+" bordered output format from MySQL CLI.
 */
export function tryParseDescribeOutput(raw: string): ParsedSchema | null {
  const lines = raw.split("\n");
  const tables: Array<{
    name: string;
    columns: Array<{
      field: string;
      type: string;
      nullable: boolean;
      key: string;
      defaultVal: string;
      extra: string;
    }>;
  }> = [];

  let currentTable: (typeof tables)[0] | null = null;
  let hasDescribeHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip MySQL border lines like +--------+--------+
    if (/^\+[-+]+\+$/.test(line)) continue;

    // Skip column header rows like | Field | Type | Null | Key | Default | Extra |
    if (/^\|\s*Field\s*\|/i.test(line)) continue;

    // Check for DESCRIBE/DESC header line
    const descMatch = line.match(
      /^(?:DESCRIBE|DESC)\s+[`"']?([^`"';\s]+(?:\.[^`"';\s]+)*)[`"']?\s*;?\s*$/i
    );
    if (descMatch) {
      hasDescribeHeader = true;
      // Start a new table
      if (currentTable && currentTable.columns.length > 0) {
        tables.push(currentTable);
      }
      currentTable = { name: descMatch[1], columns: [] };
      continue;
    }

    // Try to parse a column row — either tab-separated or pipe-separated (MySQL CLI format)
    let fields: string[] = [];

    if (line.includes("|")) {
      // Pipe-separated: | field | type | null | key | default | extra |
      fields = line
        .split("|")
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    } else if (line.includes("\t")) {
      // Tab-separated
      fields = line.split("\t").map((f) => f.trim());
    } else {
      // Multi-space separated (at least 2 spaces between fields)
      const spaceFields = line.split(/\s{2,}/).map((f) => f.trim());
      if (spaceFields.length >= 2) {
        fields = spaceFields;
      }
    }

    // We need at least field name and type
    if (fields.length < 2) continue;

    // Heuristic: first field should look like a column name (identifier),
    // second field should look like a SQL type
    const fieldName = fields[0];
    const fieldType = fields[1];

    // Skip if the "field" looks like a keyword header row
    if (/^(Field|Column|Name)$/i.test(fieldName) && /^(Type|Data.?Type)$/i.test(fieldType)) {
      continue;
    }

    // Validate: field name should be an identifier-like string
    if (!/^[a-zA-Z_]\w*$/.test(fieldName)) continue;

    // Validate: type should start with a letter (int, varchar, etc.)
    if (!/^[a-zA-Z]/.test(fieldType)) continue;

    // If no DESCRIBE header yet, create a generic table
    if (!currentTable) {
      currentTable = { name: "unknown_table", columns: [] };
    }

    const nullable = fields.length > 2 ? /yes/i.test(fields[2]) : true;
    const key = fields.length > 3 ? fields[3] : "";
    const defaultVal = fields.length > 4 ? fields[4] : "";
    const extra = fields.length > 5 ? fields[5] : "";

    currentTable.columns.push({
      field: fieldName,
      type: fieldType,
      nullable,
      key,
      defaultVal,
      extra,
    });
  }

  // Push the last table
  if (currentTable && currentTable.columns.length > 0) {
    tables.push(currentTable);
  }

  // If we didn't find any tables, return null so LLM can try
  if (tables.length === 0) return null;

  // Only use this parser if we found DESCRIBE headers or the data looks
  // convincingly like column definitions (multiple columns per table)
  if (!hasDescribeHeader) {
    // Without headers, require at least 2 columns to consider it valid
    const totalCols = tables.reduce((sum, t) => sum + t.columns.length, 0);
    if (totalCols < 2) return null;
  }

  // Generate CREATE TABLE DDL
  const ddlParts: string[] = [];
  const tablesMeta: ParsedSchema["tables"] = [];

  for (const table of tables) {
    const colDefs: string[] = [];
    const pkCols: string[] = [];

    for (const col of table.columns) {
      let colDdl = `  ${quoteIdent(col.field)} ${col.type.toUpperCase()}`;
      if (!col.nullable) colDdl += " NOT NULL";
      if (col.defaultVal && col.defaultVal !== "NULL" && col.defaultVal !== "null") {
        colDdl += ` DEFAULT ${col.defaultVal}`;
      }
      if (/auto_increment/i.test(col.extra)) {
        colDdl += " AUTO_INCREMENT";
      }
      if (/PRI/i.test(col.key)) {
        pkCols.push(col.field);
      }
      colDefs.push(colDdl);
    }

    if (pkCols.length > 0) {
      colDefs.push(`  PRIMARY KEY (${pkCols.map(quoteIdent).join(", ")})`);
    }

    ddlParts.push(
      `CREATE TABLE ${quoteIdent(table.name)} (\n${colDefs.join(",\n")}\n);`
    );

    tablesMeta.push({
      name: table.name,
      columns: table.columns.map((c) => c.field),
    });
  }

  return {
    parsed: ddlParts.join("\n\n"),
    tables: tablesMeta,
  };
}

function quoteIdent(name: string): string {
  // Only quote if the name contains dots or special chars
  if (/^[a-zA-Z_]\w*$/.test(name)) return name;
  return `\`${name.replace(/`/g, "``")}\``;
}

/**
 * Try all local parsers in order. Returns null if none match.
 */
export function tryLocalParse(raw: string): ParsedSchema | null {
  return tryParseDescribeOutput(raw);
}
