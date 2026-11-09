type KanataSqlValue = string | number | null
type KanataSqlRow = Readonly<Record<string, KanataSqlValue>>

export interface KanataSqliteWriteResult {
  readonly affectedRows: number
}

export interface KanataSqliteTransaction {
  query(sql: string, parameters?: readonly KanataSqlValue[]): Promise<readonly KanataSqlRow[]>
  execute(sql: string, parameters?: readonly KanataSqlValue[]): Promise<KanataSqliteWriteResult>
}

export interface KanataSqliteHealth {
  readonly cipher: string
  readonly journalMode: 'wal'
  readonly synchronous: 2
  readonly foreignKeys: 1
  readonly cacheSize: -2048
  readonly checkpoint: 1000
  readonly busyTimeout: 5000
}

export interface KanataSqliteOperation {
  transaction<T>(action: (tx: KanataSqliteTransaction) => Promise<T>): Promise<T>
  health(): Promise<KanataSqliteHealth>
}

export interface KanataSqliteContext {
  readonly sessionRevision: number
  readonly ownerGeneration: number
  assertCurrent(): void
  deriveKey(salt: string): Promise<Uint8Array>
}

export interface KanataSqliteDriver {
  open(context: KanataSqliteContext, options: { create: boolean }): Promise<KanataSqliteOperation>
  release(): Promise<void>
}

export interface KanataSqliteOwner {
  readonly sessionRevision: number
  readonly ownerGeneration: number
  readonly lease: string
}

export interface KanataSqliteCommand extends KanataSqliteOwner {
  readonly transaction: string
}

export interface KanataSqliteStatement extends KanataSqliteCommand {
  readonly statement: string
  readonly parameters: readonly KanataSqlValue[]
}

export interface KanataSqliteBridge {
  prepare(options: Omit<KanataSqliteOwner, 'lease'> & { create: boolean }): Promise<{ token: string; salt: string }>
  unlock(options: Omit<KanataSqliteOwner, 'lease'> & { token: string; kek: string }): Promise<{ lease: string }>
  begin(owner: KanataSqliteOwner): Promise<{ transaction: string }>
  query(command: KanataSqliteStatement): Promise<{ rows: readonly KanataSqlRow[] }>
  execute(command: KanataSqliteStatement): Promise<KanataSqliteWriteResult>
  commit(command: KanataSqliteCommand): Promise<void>
  rollback(command: KanataSqliteCommand): Promise<void>
  health(owner: KanataSqliteOwner): Promise<KanataSqliteHealth>
  completeOpen(owner: KanataSqliteOwner): Promise<void>
  close(): Promise<void>
}
