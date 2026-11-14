import pg from 'pg';

type EqFilter = { kind: 'eq'; col: string; val: unknown };
type InFilter = { kind: 'in'; col: string; vals: unknown[] };
type JsonFilter = { kind: 'json'; sql: string; val: unknown };
type Filter = EqFilter | InFilter | JsonFilter;

/** Counts every Postgres round-trip for campaign prep benchmarks. */
export class PgCountClient {
  queryCount = 0;

  constructor(readonly pool: pg.Pool) {}

  from(table: string) {
    return new TableBuilder(this, table);
  }

  async query(sql: string, params: unknown[] = []) {
    this.queryCount += 1;
    return this.pool.query(sql, params);
  }
}

class TableBuilder implements PromiseLike<{ data: any; error: null }> {
  private mode: 'select' | 'insert' | 'update' = 'select';
  private cols = '*';
  private filters: Filter[] = [];
  private rows: Record<string, unknown>[] | null = null;
  private patch: Record<string, unknown> | null = null;
  private singular: false | 'single' | 'maybe' = false;

  constructor(
    private readonly db: PgCountClient,
    private readonly table: string
  ) {}

  select(cols = '*') {
    // After insert/update, select() only means RETURNING cols (supabase style).
    if (this.mode === 'insert' || this.mode === 'update') {
      this.cols = cols;
      return this;
    }
    this.mode = 'select';
    this.cols = cols;
    return this;
  }

  insert(rowOrRows: Record<string, unknown> | Record<string, unknown>[]) {
    this.mode = 'insert';
    this.rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ kind: 'eq', col, val });
    return this;
  }

  in(col: string, vals: unknown[]) {
    this.filters.push({ kind: 'in', col, vals });
    return this;
  }

  filter(expr: string, op: string, val: unknown) {
    this.filters.push({ kind: 'json', sql: `${expr} ${op === 'eq' ? '=' : op}`, val });
    return this;
  }

  single() {
    this.singular = 'single';
    return this.execute();
  }

  maybeSingle() {
    this.singular = 'maybe';
    return this.execute();
  }

  then<T1 = { data: any; error: null }, T2 = never>(
    onfulfilled?: ((v: { data: any; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private buildWhere(params: unknown[]): string {
    const parts: string[] = [];
    for (const f of this.filters) {
      if (f.kind === 'eq') {
        params.push(f.val);
        parts.push(`${q(f.col)} = $${params.length}`);
      } else if (f.kind === 'in') {
        const ph = f.vals.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        parts.push(`${q(f.col)} IN (${ph.join(',')})`);
      } else {
        params.push(f.val);
        parts.push(`${f.sql} $${params.length}`);
      }
    }
    return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  }

  private async execute(): Promise<{ data: any; error: null }> {
    const params: unknown[] = [];
    let sql = '';

    if (this.mode === 'select') {
      sql = `SELECT ${this.cols} FROM ${q(this.table)} ${this.buildWhere(params)}`;
    } else if (this.mode === 'insert') {
      const rows = this.rows ?? [];
      if (rows.length === 0) return { data: [], error: null };
      const keys = Object.keys(rows[0]!);
      const groups = rows.map((row) => {
        const ph = keys.map((k) => {
          let v = row[k];
          if (k === 'payload' || k === 'metadata') {
            v = typeof v === 'string' ? v : JSON.stringify(v ?? {});
          }
          params.push(v);
          return k === 'payload' || k === 'metadata' ? `$${params.length}::jsonb` : `$${params.length}`;
        });
        return `(${ph.join(',')})`;
      });
      sql = `INSERT INTO ${q(this.table)} (${keys.map(q).join(',')}) VALUES ${groups.join(',')} RETURNING *`;
    } else {
      const patch = this.patch ?? {};
      const sets: string[] = [];
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'payload' || k === 'metadata') {
          params.push(typeof v === 'string' ? v : JSON.stringify(v ?? {}));
          sets.push(`${q(k)} = $${params.length}::jsonb`);
        } else {
          params.push(v);
          sets.push(`${q(k)} = $${params.length}`);
        }
      }
      sql = `UPDATE ${q(this.table)} SET ${sets.join(',')} ${this.buildWhere(params)} RETURNING *`;
    }

    const result = await this.db.query(sql, params);
    if (this.singular) {
      return { data: result.rows[0] ?? null, error: null };
    }
    return { data: result.rows, error: null };
  }
}

function q(ident: string): string {
  if (ident === '*' || ident.includes(',') || ident.includes('(')) return ident;
  return `"${ident.replace(/"/g, '""')}"`;
}
