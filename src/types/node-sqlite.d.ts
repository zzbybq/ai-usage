declare module "node:sqlite" {
  interface StatementSync { all(...params: unknown[]): Record<string, unknown>[]; }
  export class DatabaseSync {
    constructor(location: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
