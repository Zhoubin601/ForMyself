(async()=>{
  const [{useWeightStore},{usePasswordVaultStore},{createPinia},{nextTick},{preferenceStorage:storage},{STORAGE_KEYS:keys},{default:CryptoJS},{changeMasterPasswordTransaction:change},{useScheduleStore}] = await Promise.all([
    import('/src/stores/weight.js'),import('/src/stores/passwordVault.js'),import('/node_modules/.vite/deps/pinia.js'),import('/node_modules/.vite/deps/vue.js'),import('/src/platform/storage/preferences.js'),import('/src/platform/storage/keys.js'),import('/node_modules/.vite/deps/crypto-js.js'),import('/src/services/masterPasswordChange.js'),import('/src/features/schedule/scheduleStore.js')
  ])
  const result=[], delay=()=>new Promise(r=>setTimeout(r,100)), backups=new Map()
  for(const key of [keys.weightRecords,keys.passwordVault,keys.passwordVaultCategories,keys.scheduleData,keys.scheduleWidgetSnapshot]) backups.set(key,(await storage.get({key})).value)
  const originalSet=Storage.prototype.setItem
  try {
    const weight=useWeightStore(createPinia())
    await storage.set({key:keys.weightRecords,value:'{broken-synthetic-json'})
    await weight.loadWeightRecords()
    const corruptBefore=(await storage.get({key:keys.weightRecords})).value
    weight.addRecord({id:'qa-fault',date:'2026-10-03',weight:60,note:'synthetic'})
    await nextTick(); await storage.flush()
    result.push({test:'corrupt-weight-load',isDataLoaded:weight.isDataLoaded,loadError:weight.loadError??null,originalCorruptionPreserved:(await storage.get({key:keys.weightRecords})).value===corruptBefore})
    const schedule=useScheduleStore(createPinia()),invalidSchedule='{broken-synthetic-schedule'
    await storage.set({key:keys.scheduleData,value:invalidSchedule});await schedule.loadSchedules();await delay();await storage.flush()
    result.push({test:'corrupt-schedule-load',isDataLoaded:schedule.isDataLoaded,originalCorruptionPreserved:(await storage.get({key:keys.scheduleData})).value===invalidSchedule,remainingSeries:schedule.series.length})

    const password=crypto.randomUUID(),wrong=crypto.randomUUID(),vault=usePasswordVaultStore(createPinia())
    await storage.set({key:keys.passwordVault,value:CryptoJS.AES.encrypt(JSON.stringify([{id:'qa-vault',appName:'Synthetic QA',account:'qa',password:crypto.randomUUID()}]),password).toString()})
    await storage.set({key:keys.passwordVaultCategories,value:CryptoJS.AES.encrypt(JSON.stringify(['未分类']),password).toString()})
    const before=(await storage.get({key:keys.passwordVault})).value
    await vault.loadRecords(wrong); await nextTick(); await delay(); await storage.flush()
    const after=(await storage.get({key:keys.passwordVault})).value
    let decryptedAfter
    try { decryptedAfter=JSON.parse(CryptoJS.AES.decrypt(after,wrong).toString(CryptoJS.enc.Utf8)).length } catch {decryptedAfter=null}
    result.push({test:'vault-decrypt-failure',loadError:vault.loadError,isDataLoaded:vault.isDataLoaded,ciphertextPreserved:before===after,recordsRemainingUnderAttemptedPassword:decryptedAfter})

    const old=crypto.randomUUID(),updated=crypto.randomUUID(),v2=usePasswordVaultStore(createPinia())
    await storage.set({key:keys.passwordVault,value:CryptoJS.AES.encrypt(JSON.stringify([{id:'qa-change',appName:'Synthetic QA',account:'qa',password:crypto.randomUUID()}]),old).toString()})
    await storage.set({key:keys.passwordVaultCategories,value:CryptoJS.AES.encrypt(JSON.stringify(['未分类']),old).toString()})
    await v2.loadRecords(old); await nextTick(); await delay(); await storage.flush()
    let failOnce=true,committed=false,caught=''
    Storage.prototype.setItem=function(key,value){if(key.endsWith(keys.passwordVaultCategories)&&failOnce){failOnce=false;throw new Error('QA_SIMULATED_WRITE_FAILURE')}return originalSet.call(this,key,value)}
    try { await change({currentPassword:old,newPassword:updated,reencryptors:[v2.reencrypt],commit:()=>{committed=true}}) } catch(e){caught=e.message}
    await nextTick(); await delay(); await storage.flush()
    const encrypted=(await storage.get({key:keys.passwordVault})).value
    const canDecrypt=p=>{try{return JSON.parse(CryptoJS.AES.decrypt(encrypted,p).toString(CryptoJS.enc.Utf8)).length>0}catch{return false}}
    result.push({test:'partial-password-change-write-failure',caught,committed,oldPasswordDecrypts:canDecrypt(old),newPasswordDecrypts:canDecrypt(updated)})
  } finally {
    Storage.prototype.setItem=originalSet
    for(const [key,value] of backups){if(value===null)await storage.remove({key});else await storage.set({key,value})}
  }
  return result
})()
