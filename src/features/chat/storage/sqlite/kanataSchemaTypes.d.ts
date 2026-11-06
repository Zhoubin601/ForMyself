export type KanataSqlValue = string | number | null
export type KanataSqlRow = Readonly<Record<string, KanataSqlValue>>
export interface KanataSchemaTransaction {
  /** Executes exactly one statement; a CREATE TRIGGER body is one statement. */
  execute(sql: string, parameters?: readonly KanataSqlValue[]): Promise<void>
  query(sql: string, parameters?: readonly KanataSqlValue[]): Promise<readonly KanataSqlRow[]>
}
export interface KanataSchemaConnection {
  /** Exclusive BEGIN IMMEDIATE. Roll back callback AND commit failures. Never nest or
   * interleave with ordinary writes. Caller owns a valid protected session/restore lease.
   * Android uses NO_LOCALIZED_COLLATORS and setForeignKeyConstraintsEnabled(true)
   * for binary ordering and consistent FK enforcement across the connection pool.
   * Do not drop/ignore unknown platform tables to disguise a nonempty database. */
  transaction<T>(operation: (transaction: KanataSchemaTransaction) => Promise<T>): Promise<T>
}
export interface KanataSchemaMigration {
  readonly version: number
  readonly name: string
  readonly statements: readonly string[]
}
export interface KanataSchemaResult {
  readonly version: number
  readonly appliedVersions: readonly number[]
}
