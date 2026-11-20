export type PortableErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'RESOURCE_LIMIT'
  | 'AUTH_FAILED'
  | 'INVALID_CONTAINER'
  | 'INVALID_LOGICAL'
  | 'INVALID_PASSWORD_INPUT'
  | 'IO_FAILED'
  | 'CANCELLED'

export type PortableTableCategory = 'business' | 'derived' | 'runtime'
export type PortableColumnType = 'TEXT' | 'INTEGER' | 'REAL'
export type PortableValue = string | bigint | number | null
export type PortableRowRecord = Record<string, PortableValue | unknown>

export interface PortableColumnSpec {
  readonly name: string
  readonly cid: number
  readonly type: PortableColumnType
  readonly notnull: boolean
  readonly pk: number
}

export interface PortableTableSpec {
  readonly tableId: number
  readonly name: string
  readonly category: PortableTableCategory
  readonly hasOrdinal: boolean
  readonly columns: readonly PortableColumnSpec[]
  readonly pkColumns: readonly string[]
  readonly columnsByName: Readonly<Record<string, PortableColumnSpec>>
}

export interface PortableSha256Hasher {
  update(chunk: Uint8Array): void
  digest(): Uint8Array
}

export interface PortableCryptoProvider {
  randomBytes(length: number): Uint8Array
  pbkdf2Sha256(
    passwordBytes: Uint8Array,
    salt: Uint8Array,
    iterations: number,
    keyLength: number,
  ): Promise<Uint8Array> | Uint8Array
  hkdfSha256(
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    keyLength: number,
  ): Promise<Uint8Array> | Uint8Array
  aesGcmEncrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array> | Uint8Array
  aesGcmDecrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertextAndTag: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array> | Uint8Array
  createSha256(): PortableSha256Hasher
}

export interface PortableTableVerifier {
  readonly tableId: number
  readonly rowCount: bigint
  readonly digest: Uint8Array
}

export interface PortablePublicHeader {
  readonly format: 1
  readonly suite: 1
  readonly profile: 0xff01
  readonly iterations: 600000
  readonly salt: Uint8Array
  readonly backupId: Uint8Array
  readonly scope: 1
  readonly payload: 1
  readonly frameLimit: 65536
}

export interface PortableManifest {
  readonly applicationId: 0x4b4e5441
  readonly schema: 5
  readonly schemaFingerprint: Uint8Array
  readonly taskPolicy: 1
  readonly profileReserved: 0
}

export interface PortableFooter {
  readonly dataFrameCount: number
  readonly totalPlaintextBytes: bigint
  readonly totalCiphertextBytes: bigint
  readonly transcript: Uint8Array
  readonly verifiers: readonly PortableTableVerifier[]
}

export interface PortableVerifyContext {
  readonly header: PortablePublicHeader
  readonly manifest: PortableManifest
  readonly footer: PortableFooter
}

export interface PortableStagingSink {
  beginTable(table: PortableTableSpec, rowCount: bigint): Promise<void> | void
  writeRow(table: PortableTableSpec, row: PortableRowRecord, ordinal: bigint | null): Promise<void> | void
  finishTable(table: PortableTableSpec, rowCount: bigint, digest: Uint8Array): Promise<void> | void
  verify(verifiers: readonly PortableTableVerifier[], context: PortableVerifyContext): Promise<void> | void
  commit(): Promise<void> | void
  abort(): Promise<void> | void
}

export type PortableTableRowSource =
  | readonly PortableRowRecord[]
  | {
      readonly rowCount: number | bigint
      readonly rows: Iterable<PortableRowRecord> | AsyncIterable<PortableRowRecord>
    }

export type PortableByteSource =
  | Uint8Array
  | AsyncIterable<Uint8Array>
  | Iterable<Uint8Array>
  | (() => Promise<Uint8Array | null> | Uint8Array | null)

export interface PortableEncodeMaterial {
  readonly salt: Uint8Array
  readonly backupId: Uint8Array
  readonly wrapNonce: Uint8Array
  readonly bek: Uint8Array
}

export interface PortableEncodeOptions {
  readonly password: string
  readonly getTableSource: (tableDef: PortableTableSpec) => PortableTableRowSource
  readonly derivedVerifiers: readonly PortableTableVerifier[]
  readonly cryptoProvider: PortableCryptoProvider
  readonly material?: PortableEncodeMaterial
  readonly signal?: AbortSignal
  readonly applyTaskPolicy?: boolean
  readonly validateJson?: boolean
}

export interface PortableDecodeOptions {
  readonly source: PortableByteSource
  readonly password: string
  readonly stagingSink: PortableStagingSink
  readonly cryptoProvider: PortableCryptoProvider
  readonly signal?: AbortSignal
  readonly validateJson?: boolean
}

export interface PortableDecodeResult {
  readonly header: PortablePublicHeader
  readonly manifest: PortableManifest
  readonly footer: PortableFooter
}

export declare function encodePortableContainer(
  options: PortableEncodeOptions,
): AsyncGenerator<Uint8Array, Omit<PortableFooter, never>, void>

export declare function decodePortableContainer(
  options: PortableDecodeOptions,
): Promise<PortableDecodeResult>
