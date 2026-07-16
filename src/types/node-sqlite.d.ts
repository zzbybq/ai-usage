// Minimal ambient types for node:sqlite. @types/node@20 (pinned in this
// project) predates the built-in node:sqlite module, but the runtime is
// Node 24+ where it ships with the binary. Declare just the surface we use so
// tsc passes without bumping @types/node (which could shift other types).
declare module "node:sqlite" {
  type SQLiteOptions = {
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
    allowExtension?: boolean;
    loadExtension?: string | string[];
  };

  type StatementResult = Record<string, unknown>;

  interface StatementSync {
    all(...params: unknown[]): StatementResult[];
    get(...params: unknown[]): StatementResult | undefined;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(location: string, options?: SQLiteOptions);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
    open(): void;
    dirname: string;
    path: string;
    readOnly: boolean;
  }
}
