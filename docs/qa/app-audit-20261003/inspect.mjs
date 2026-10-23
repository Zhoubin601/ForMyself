import { connect } from './cdp.mjs'
import { readFile } from 'node:fs/promises'
const c=await connect()
try {
  const expression=process.argv[2]==='--file' ? await readFile(process.argv[3],'utf8') : process.argv.slice(2).join(' ')
  console.log(JSON.stringify(await c.evaluate(expression),null,2))
} finally { c.close() }
