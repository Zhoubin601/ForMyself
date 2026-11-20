import { createCipheriv, createHash, hkdfSync, pbkdf2Sync } from 'node:crypto'

/**
 * Independent test-only container assembler using raw `node:crypto` + `Buffer`
 * (intentionally independent of `containerCodec.js` and `logicalCodec.js`).
 * Allows crafting valid-AEAD containers with targeted protocol or logical violations.
 */
export function buildCustomPortablePackage({
  password,
  salt = Buffer.from(Array.from({ length: 16 }, (_, i) => i)),
  backupId = Buffer.from(Array.from({ length: 16 }, (_, i) => 16 + i)),
  wrapNonce = Buffer.from(Array.from({ length: 12 }, (_, i) => 32 + i)),
  bek = Buffer.from(Array.from({ length: 32 }, (_, i) => 64 + i)),
  headerMutator = null,
  manifestPayload = null,
  manifestFrameHeaderMutator = null,
  dataFrames = [],
  footerPayloadBuilder = null,
  footerFrameHeaderMutator = null,
  trailingBytes = Buffer.alloc(0),
}) {
  const header = Buffer.alloc(64)
  Buffer.from('4b414e4154413100', 'hex').copy(header, 0)
  header.writeUInt16BE(1, 8)
  header.writeUInt16BE(1, 10)
  header.writeUInt16BE(0xff01, 12)
  header.writeUInt16BE(0, 14)
  header.writeUInt32BE(600000, 16)
  salt.copy(header, 20)
  backupId.copy(header, 36)
  header[52] = 1
  header[53] = 1
  header.writeUInt32BE(65536, 54)
  if (headerMutator) headerMutator(header)

  const pw = Buffer.from(password, 'utf8')
  const baseKek = pbkdf2Sync(pw, Buffer.concat([Buffer.from('KPB1/KEK\0'), salt, backupId]), 600000, 32, 'sha256')
  const wrapKey = Buffer.from(hkdfSync('sha256', baseKek, backupId, Buffer.concat([Buffer.from('KPB1/wrap\0'), header]), 32))

  const wrapCipher = createCipheriv('aes-256-gcm', wrapKey, wrapNonce, { authTagLength: 16 })
  wrapCipher.setAAD(header)
  const wrappedBek = Buffer.concat([wrapCipher.update(bek), wrapCipher.final(), wrapCipher.getAuthTag()])
  const prefix = Buffer.concat([header, wrapNonce, wrappedBek])
  const envelopeDigest = createHash('sha256').update(prefix).digest()

  const frameKey = (streamId, type) => {
    const info = Buffer.alloc(14)
    Buffer.from('KPB1/frame\0').copy(info, 0)
    info.writeUInt16BE(streamId, 11)
    info[13] = type
    return Buffer.from(hkdfSync('sha256', bek, backupId, info, 32))
  }

  const frameNonce = (streamId, type, index) => {
    const n = Buffer.alloc(12)
    n.writeUInt16BE(streamId, 0)
    n[2] = type
    n[3] = 0
    n.writeBigUInt64BE(BigInt(index), 4)
    return n
  }

  const sealFrame = (streamId, type, flags, index, plaintext, headerMutatorFn = null, nonceOverride = null) => {
    const fh = Buffer.alloc(20)
    fh.writeUInt16BE(streamId, 0)
    fh[2] = type
    fh[3] = flags
    fh.writeBigUInt64BE(BigInt(index), 4)
    fh.writeUInt32BE(plaintext.byteLength, 12)
    fh.writeUInt32BE(plaintext.byteLength + 16, 16)
    if (headerMutatorFn) headerMutatorFn(fh)
    const key = frameKey(streamId, type)
    const nonce = nonceOverride ?? frameNonce(streamId, type, index)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
    cipher.setAAD(Buffer.concat([envelopeDigest, fh]))
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
    return { fh, ct }
  }

  const transcript = createHash('sha256')
  transcript.update(Buffer.concat([Buffer.from('KPB1/transcript\0'), envelopeDigest]))

  const defaultManifest = Buffer.alloc(40)
  defaultManifest.writeUInt32BE(0x4b4e5441, 0)
  defaultManifest.writeUInt16BE(5, 4)
  Buffer.from('8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a', 'hex').copy(defaultManifest, 6)
  defaultManifest[38] = 1
  defaultManifest[39] = 0

  const mf = sealFrame(0, 1, 0, 0, manifestPayload ?? defaultManifest, manifestFrameHeaderMutator)
  transcript.update(mf.fh)
  transcript.update(mf.ct)

  const parts = [prefix, mf.fh, mf.ct]
  let totalPlain = 0n
  let totalCipher = 0n

  for (const spec of dataFrames) {
    const df = sealFrame(
      spec.streamId ?? 1,
      spec.type ?? 2,
      spec.flags ?? 1,
      spec.index ?? 0,
      spec.plaintext,
      spec.headerMutator ?? null,
      spec.nonceOverride ?? null,
    )
    transcript.update(df.fh)
    transcript.update(df.ct)
    parts.push(df.fh, df.ct)
    totalPlain += BigInt(spec.plaintext.byteLength)
    totalCipher += BigInt(df.ct.byteLength)
  }

  const actualTranscript = transcript.digest()
  const footerPlain = footerPayloadBuilder({
    dataFrameCount: dataFrames.length,
    totalPlaintextBytes: totalPlain,
    totalCiphertextBytes: totalCipher,
    transcript: actualTranscript,
  })
  const ff = sealFrame(0, 3, 0, 0, footerPlain, footerFrameHeaderMutator)
  parts.push(ff.fh, ff.ct, trailingBytes)
  return new Uint8Array(Buffer.concat(parts))
}

/**
 * Build valid 45-table logical payload buffer and matching 50-table verifiers from raw table row buffers.
 */
export function buildRawLogicalStream(businessTables, tableOrderOverride = null) {
  const RUNTIME = new Set([10, 41, 42])
  const DERIVED = new Set([4, 13, 15, 16, 35])
  const order =
    tableOrderOverride ??
    Array.from({ length: 53 }, (_, i) => i + 1).filter(id => !RUNTIME.has(id) && !DERIVED.has(id))

  const chunks = []
  const verifiers = new Map()
  for (const tid of order) {
    const rows = businessTables.get(tid) ?? []
    const h = Buffer.alloc(10)
    h.writeUInt16BE(tid, 0)
    h.writeBigUInt64BE(BigInt(rows.length), 2)
    chunks.push(h)
    const dig = createHash('sha256')
    const p = Buffer.alloc(13)
    Buffer.from('KPB1/table\0').copy(p, 0)
    p.writeUInt16BE(tid, 11)
    dig.update(p)
    for (const body of rows) {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(body.byteLength, 0)
      chunks.push(len, body)
      dig.update(len)
      dig.update(body)
    }
    verifiers.set(tid, { tableId: tid, rowCount: BigInt(rows.length), digest: dig.digest() })
  }
  for (const tid of DERIVED) {
    const p = Buffer.alloc(13)
    Buffer.from('KPB1/table\0').copy(p, 0)
    p.writeUInt16BE(tid, 11)
    verifiers.set(tid, { tableId: tid, rowCount: 0n, digest: createHash('sha256').update(p).digest() })
  }
  return { logical: Buffer.concat(chunks), verifiers }
}

export function encodeFooterBuffer({ dataFrameCount, totalPlaintextBytes, totalCiphertextBytes, transcript, verifiers }) {
  const out = Buffer.alloc(2152)
  out.writeUInt32BE(dataFrameCount, 0)
  out.writeBigUInt64BE(totalPlaintextBytes, 4)
  out.writeBigUInt64BE(totalCiphertextBytes, 12)
  Buffer.from(transcript).copy(out, 20)
  let offset = 52
  for (const v of verifiers) {
    out.writeUInt16BE(v.tableId, offset)
    out.writeBigUInt64BE(v.rowCount, offset + 2)
    Buffer.from(v.digest).copy(out, offset + 10)
    offset += 42
  }
  return out
}
