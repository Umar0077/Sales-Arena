import type { Pool } from "pg";

export interface MigrationDef {
  version: string;
  file: string;
}
export const MIGRATIONS: MigrationDef[];
export function defaultMigrationsDir(): string;
export function migrationStatus(
  pool: Pool,
  dir?: string,
): Promise<Array<{ version: string; applied: boolean; appliedAt: Date | null; checksumMatches: boolean | null }>>;
export function runMigrations(
  pool: Pool,
  opts?: { dir?: string; log?: (msg: string) => void },
): Promise<{ applied: string[]; skipped: string[] }>;
