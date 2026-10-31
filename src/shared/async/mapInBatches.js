// @ts-check
/** Bound independent I/O while settling the entire active batch before propagating failure.
 * @template T,R
 * @param {readonly T[]} items
 * @param {(item:T,index:number)=>R|Promise<R>} operation
 * @param {number} [concurrency]
 * @returns {Promise<R[]>}
 */
export async function mapInBatches(items,operation,concurrency=4) {
  if(!Array.isArray(items)||typeof operation!=='function'||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('INVALID_IO_BATCH')
  /** @type {R[]} */
  const output=[]
  for(let start=0;start<items.length;start+=concurrency){
    const settled=await Promise.allSettled(items.slice(start,start+concurrency).map((item,index)=>Promise.resolve().then(()=>operation(item,start+index))))
    const failure=settled.find(result=>result.status==='rejected')
    if(failure?.status==='rejected')throw failure.reason
    for(const result of settled)if(result.status==='fulfilled')output.push(result.value)
  }
  return output
}
