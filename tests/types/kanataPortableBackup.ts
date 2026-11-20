import type {
  PortableCryptoProvider,
  PortableDecodeOptions,
  PortableEncodeOptions,
  PortableErrorCode,
  PortableFooter,
  PortableManifest,
  PortablePublicHeader,
  PortableStagingSink,
  PortableTableVerifier,
} from '../../src/application/contracts'

declare const cryptoProvider: PortableCryptoProvider
declare const sink: PortableStagingSink
declare const verifiers: readonly PortableTableVerifier[]

const validEncode: PortableEncodeOptions = {
  password: 'synthetic-password',
  getTableSource: () => [],
  derivedVerifiers: verifiers,
  cryptoProvider,
}

const validDecode: PortableDecodeOptions = {
  source: new Uint8Array(0),
  password: 'synthetic-password',
  stagingSink: sink,
  cryptoProvider,
}

void validEncode
void validDecode

const validError: PortableErrorCode = 'INVALID_LOGICAL'
void validError

// @ts-expect-error synthetic header profile must stay isolated at 0xff01, never production 0x0001
const badProfile: PortablePublicHeader['profile'] = 0x0001
void badProfile

// @ts-expect-error manifest schema version is fixed to 5 in kanata-logical-v1
const badSchema: PortableManifest['schema'] = 4
void badSchema

// @ts-expect-error rowCount in table verifiers must be exact BigInt, never coerced string
const badVerifier: PortableTableVerifier = { tableId: 1, rowCount: '0', digest: new Uint8Array(32) }
void badVerifier

// @ts-expect-error staging sink cannot omit abort() or verify() rollback/validation hooks
const incompleteSink: PortableStagingSink = {
  beginTable() {},
  writeRow() {},
  finishTable() {},
  commit() {},
}
void incompleteSink

// @ts-expect-error footer totalPlaintextBytes must be exact BigInt, not number
const badFooterCount: PortableFooter['totalPlaintextBytes'] = 100
void badFooterCount

// @ts-expect-error unknown error codes outside the stable hierarchy are forbidden
const badError: PortableErrorCode = 'SILENT_FALLBACK'
void badError
