/** Existing encryption envelope. Compression never changes its cryptographic protocol or version. */
export interface RestoreCipherEnvelope {version:1;salt:string;iv:string;ciphertext:string}
/** Optional JSON data wrapping INSIDE the authenticated envelope; never a direct business restore input. */
export interface CompressedRestorePayload {
  type:'formyself-restore-payload';version:2;encoding:'gzip-json-v1';plainBytes:number;data:string
}
