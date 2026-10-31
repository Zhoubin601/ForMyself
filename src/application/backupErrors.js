/** User-facing recovery guidance, without exposing private payloads or misclassifying valid large backups.
 * @param {unknown} error @returns {string} */
export function backupFailureGuidance(error){
  const code=error&&typeof error==='object'&&'code' in error?error.code:undefined
  if(code==='RESTORE_PAYLOAD_TOO_LARGE')return'恢复资料过大，暂时无法安全处理。请保留备份和现有应用数据。'
  if(code==='RESTORE_COMPRESSION_UNAVAILABLE')return'当前环境暂时不能安全处理这份恢复资料，请保留备份并稍后重试。'
  if(code==='UNSUPPORTED_RESTORE_PAYLOAD')return'恢复资料使用了当前版本不支持的格式，请保留备份和现有应用数据。'
  if(['RESTORE_PAYLOAD_SIZE_MISMATCH','RESTORE_PAYLOAD_INVALID_COMPRESSION','RESTORE_PAYLOAD_INVALID_ENCODING','RESTORE_PAYLOAD_INVALID_JSON'].includes(String(code)))return'恢复资料未能通过完整性检查，请保留备份和现有应用数据后重试。'
  return''
}
