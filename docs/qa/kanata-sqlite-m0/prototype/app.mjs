import {CapacitorSQLite} from '@capacitor-community/sqlite'
const out=document.querySelector('#result'),button=document.querySelector('#run')
const check=(value,code)=>{if(!value)throw Error(code)}
button.onclick=async()=>{
  button.disabled=true
  const results=[], database='m0_'+crypto.randomUUID().replaceAll('-',''),bytes=crypto.getRandomValues(new Uint8Array(32))
  let secret=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),created=false,secretAttempted=false
  const options={database,readonly:false}
  try {
    // Unmodified plugin API requires a persisted encrypted secret. This remains a M0 limitation.
    check(!(await CapacitorSQLite.isSecretStored()).result,'QA_EXISTING_SECRET_REFUSE')
    secretAttempted=true
    await CapacitorSQLite.setEncryptionSecret({passphrase:secret})
    await CapacitorSQLite.createConnection({...options,encrypted:true,mode:'secret',version:1});created=true
    await CapacitorSQLite.open(options)
    const cipher=await CapacitorSQLite.query({...options,statement:'PRAGMA cipher_version;',values:[]})
    check(JSON.stringify(cipher.values).includes('4.'),'CIPHER_NOT_ENABLED');results.push({test:'cipher_version',values:cipher.values})
    await CapacitorSQLite.query({...options,statement:'PRAGMA journal_mode=WAL;',values:[]})
    await CapacitorSQLite.execute({...options,statements:'CREATE TABLE qa(id INTEGER PRIMARY KEY,body TEXT NOT NULL);',transaction:true})
    await CapacitorSQLite.run({...options,statement:'INSERT INTO qa VALUES(?,?);',values:[1,'synthetic-only'],transaction:true})
    await CapacitorSQLite.executeSet({...options,set:[{statement:'INSERT INTO qa VALUES(?,?);',values:[2,'synthetic-two']},{statement:'INSERT INTO qa VALUES(?,?);',values:[3,'synthetic-three']}],transaction:true})
    await CapacitorSQLite.beginTransaction(options)
    await CapacitorSQLite.run({...options,statement:'INSERT INTO qa VALUES(?,?);',values:[4,'rollback-only'],transaction:false})
    await CapacitorSQLite.rollbackTransaction(options)
    const rows=await CapacitorSQLite.query({...options,statement:'SELECT count(*) AS n FROM qa;',values:[]})
    check(rows.values?.[0]?.n===3,'ROLLBACK_FAILED');results.push({test:'crud_batch_rollback',status:'PASS'})
    await CapacitorSQLite.run({...options,statement:'UPDATE qa SET body=? WHERE id=?;',values:['edited',1],transaction:true})
    await CapacitorSQLite.run({...options,statement:'DELETE FROM qa WHERE id=?;',values:[3],transaction:true})
    await CapacitorSQLite.beginTransaction(options)
    await CapacitorSQLite.run({...options,statement:'INSERT INTO qa VALUES(?,?);',values:[5,'committed'],transaction:false})
    await CapacitorSQLite.commitTransaction(options)
    for(let i=0;i<5;i++){await CapacitorSQLite.close(options);await CapacitorSQLite.open(options)}
    const integrity=await CapacitorSQLite.query({...options,statement:'PRAGMA integrity_check;',values:[]})
    check(Object.values(integrity.values?.[0]??{}).includes('ok'),'INTEGRITY_FAILED')
    const cipherIntegrity=await CapacitorSQLite.query({...options,statement:'PRAGMA cipher_integrity_check;',values:[]})
    results.push({test:'commit_reopen_integrity',status:'PASS',integrity:integrity.values,cipherIntegrity:cipherIntegrity.values})
    results.push({test:'wrong_key_plain_sqlite_force_stop_log_scan',status:'NOT RUN',reason:'Requires native instrumentation, extracted synthetic database and device-side process/log evidence; bridge smoke alone is insufficient.'})
    window.qaM0Result={status:'SMOKE_ONLY_LIFECYCLE_BLOCKED',results}
  } catch {window.qaM0Result={status:'FAIL',results,code:'QA_BRIDGE_FAILED'}}
  finally {
    let cleanupFailed=false
    if(created){
      try{await CapacitorSQLite.close(options);await CapacitorSQLite.deleteDatabase(options);await CapacitorSQLite.closeConnection(options)}catch{cleanupFailed=true}
    }
    // Do not clear a preexisting credential when refusal happened before setEncryptionSecret.
    if(secretAttempted)try{await CapacitorSQLite.clearEncryptionSecret()}catch{cleanupFailed=true}
    if(cleanupFailed)window.qaM0Result={...window.qaM0Result,status:'FAIL',cleanup:'QA_CLEANUP_FAILED'}
    bytes.fill(0);secret=''
    out.textContent=JSON.stringify(window.qaM0Result,null,2)
    button.disabled=false
  }
}
