import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import postcss from 'postcss'
import { buildThemeCssVariables, THEME_PRESETS, contrastRatio } from '../../../src/services/themeSystem.js'

const root = process.cwd()
const qa = path.join(root, 'docs/qa/design-system-20261007')
const evidence = JSON.parse(fs.readFileSync(path.join(qa, 'source-evidence.json'), 'utf8'))
const mdPath = path.join(root, 'output/20261007-formyself-design-system-v1.md')
const cssPath = path.join(root, 'output/20261007-formyself-design-tokens-v1.css')
const md = fs.readFileSync(mdPath, 'utf8'), css = fs.readFileSync(cssPath, 'utf8')
const ast = postcss.parse(css, { from: cssPath })
const definitions = new Set(), refs = new Set()
ast.walkDecls(decl => {
  assert.ok(decl.prop.startsWith('--fm-'), `Non-token CSS declaration: ${decl.prop}`)
  definitions.add(decl.prop)
  for (const match of decl.value.matchAll(/var\((--[\w-]+)/g)) refs.add(match[1])
})
for (const ref of refs) assert.ok(definitions.has(ref) || ref.startsWith('--theme-'), `Undefined reference: ${ref}`)
assert.ok(definitions.size > 150)
const checkedLinks = []
for (const match of md.matchAll(/\]\(<([^>]+)>\)/g)) {
  const target = match[1].replace(/:\d+$/, '')
  if (target.endsWith('/verification.md') && !fs.existsSync(target)) continue // 首轮写入验证完成后产生
  assert.ok(fs.existsSync(target), `Broken local link: ${target}`)
  checkedLinks.push(target)
}
assert.equal((md.match(/^```/gm) || []).length, 4, 'Two complete code fences expected')
assert.ok(md.includes('ui-ux-pro-max') && md.includes('design-system') && md.includes('morphicons') && md.includes('lucide-vue-next'))
assert.equal((md.match(/^## /gm) || []).length, 15)
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes:true }).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]) : []
const rawAfter = crypto.createHash('sha256').update(walk(path.join(root,'raw')).sort().map(file => `${path.relative(root,file)}:${digest(file)}`).join('\n')).digest('hex')
assert.equal(rawAfter, evidence.rawAggregateSha256Before)
for (const source of evidence.sources) assert.equal(digest(path.join(root, source.file)), source.sha256, `Changed source: ${source.file}`)
for (const shot of evidence.screenshots) assert.equal(digest(path.join(root, shot.file)), shot.sha256, `Changed screenshot: ${shot.file}`)

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'formyself-design-tokens-20261007-'))
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', 'about:blank'], { windowsHide:true, stdio:'ignore' })
browser.on('error', error => { console.error(error.message) })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket, send, browserResult
try {
  const activePort = path.join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 80 && !fs.existsSync(activePort); i++) await sleep(100)
  assert.ok(fs.existsSync(activePort), 'Chrome DevTools did not start')
  const port = Number(fs.readFileSync(activePort, 'utf8').split('\n')[0])
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())
  const page = targets.find(t => t.type === 'page')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen=resolve; socket.onerror=reject })
  let sequence=0
  const pending=new Map()
  socket.onmessage=event=>{
    const response=JSON.parse(event.data), request=pending.get(response.id)
    if(!request)return
    clearTimeout(request.timer);pending.delete(response.id)
    response.error?request.reject(new Error(response.error.message)):request.resolve(response.result)
  }
  send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence, timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`))},10000)
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))
  })
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  await send('Page.enable')
  const {frameTree}=await send('Page.getFrameTree')
  const html=`<!doctype html><html lang="zh-CN"><head><style>${css}</style></head><body><div class="fm-design-system"><button id="sample" style="background:var(--fm-button-bg);color:var(--fm-button-fg);min-height:var(--fm-button-height);border-radius:var(--fm-button-radius);transition:filter var(--fm-button-duration);">保存</button></div></body></html>`
  await send('Page.setDocumentContent',{frameId:frameTree.frame.id,html})
  const inspect=`(()=>{const root=getComputedStyle(document.documentElement), button=getComputedStyle(document.querySelector('#sample'));return {buttonBackground:button.backgroundColor,buttonText:button.color,minHeight:button.minHeight,duration:button.transitionDuration,unresolved:${JSON.stringify([...definitions])}.filter(name=>!root.getPropertyValue(name).trim())}})()`
  const standalone=[]
  for(const [id] of Object.entries(THEME_PRESETS)){
    await evaluate(`document.documentElement.setAttribute('data-fm-theme',${JSON.stringify(id)})`)
    const result=await evaluate(inspect)
    const vars=buildThemeCssVariables({presetId:id}),hex=vars['--theme-primary-strong']
    const rgb=`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`
    assert.equal(result.buttonBackground,rgb,`Standalone theme ${id}`)
    assert.equal(result.buttonText,'rgb(255, 255, 255)')
    assert.equal(result.minHeight,'48px')
    assert.deepEqual(result.unresolved,[])
    assert.equal(result.duration,'0.18s')
    standalone.push({id,...result,contrast:contrastRatio(hex,'#FFFFFF')})
  }
  const bridges=[]
  for(const settings of [...Object.keys(THEME_PRESETS).map(presetId=>({presetId})),{mode:'custom',customPrimary:'#F8DD55'}]){
    const vars=buildThemeCssVariables(settings)
    await evaluate(`Object.entries(${JSON.stringify(vars)}).forEach(([name,value])=>document.documentElement.style.setProperty(name,value))`)
    const result=await evaluate(inspect),hex=vars['--theme-primary-strong']
    assert.equal(result.buttonBackground,`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`)
    assert.deepEqual(result.unresolved,[])
    assert.ok(contrastRatio(hex,'#FFFFFF')>=4.5)
    bridges.push({settings,...result,contrast:contrastRatio(hex,'#FFFFFF')})
  }
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  const reduced=await evaluate(inspect)
  assert.equal(reduced.duration,'0s')
  const durations=await evaluate(`(()=>{const c=getComputedStyle(document.documentElement);return ['fast','control','panel','progress'].map(key=>c.getPropertyValue('--fm-duration-'+key).trim())})()`)
  assert.deepEqual(durations,['0ms','0ms','0ms','0ms'])
  browserResult={standalone,bridges,reducedMotion:{duration:reduced.duration,tokens:durations},noRemoteResources:await evaluate('performance.getEntriesByType("resource").map(e=>e.name)')}
  assert.deepEqual(browserResult.noRemoteResources,[])
} finally {
  try {if(send)await send('Browser.close')}catch{}
  if(socket)socket.close()
  for(let i=0;i<40 && browser.exitCode===null;i++)await sleep(100)
  if(browser.exitCode===null)browser.kill()
  const realProfile=fs.realpathSync(profile),realTemp=fs.realpathSync(os.tmpdir())
  assert.ok(realProfile.startsWith(realTemp+path.sep) && path.basename(realProfile).startsWith('formyself-design-tokens-20261007-'), 'Unexpected temporary profile path')
  for(let i=0;i<20;i++){
    try {fs.rmSync(realProfile,{recursive:true,force:true});break}catch(error){if(i===19)throw error;await sleep(200)}
  }
}
const report={date:'2026-10-07',cssParsing:'passed',tokenCount:definitions.size,referenceCount:refs.size,checkedLocalLinks:checkedLinks.length,sections:15,rawUnchanged:true,sourceFilesUnchanged:evidence.sources.length,screenshotFilesUnchanged:evidence.screenshots.length,browser:browserResult,outputs:[mdPath,cssPath].map(file=>({file,bytes:fs.statSync(file).size,sha256:digest(file)}))}
fs.writeFileSync(path.join(qa,'verification-results.json'),JSON.stringify(report,null,2)+'\n')
fs.writeFileSync(path.join(qa,'verification.md'),`# 2026-10-07 Design System 交付验证\n\n- CSS通过已安装PostCSS解析；${definitions.size}个不同fm-*变量、${refs.size}个引用通过定义/回退核对。\n- 使用独立临时Chrome profile和about:blank验证；四预设回退、四预设运行时桥接及黄色自定义主题均符合算法派生值。没有加载任何页面远程资源。\n- 示例按钮48px，正常过渡180ms；减少动画下fast/control/panel/progress为0ms，按钮计算过渡0s；所有fm-*变量均可解析。\n- Markdown含15个章节、两个完整代码块；${checkedLinks.length}个本地链接存在；验证记录自身链接在本步骤生成。\n- 30个来源文件、7个历史截图SHA-256未变；raw整体摘要未变。原有docs修改保留并追加本轮记录。\n- 未运行App全功能测试、未修改产品UI、未构建APK或验证原生桌面/真机。此前截图来自2026-10-03，未声明为本轮新测试。\n- 临时Chrome进程已关闭，专用临时profile经绝对路径范围核对后清理。\n\n详细JSON：verification-results.json；来源快照：source-evidence.json。\n`)
const planFile=path.join(root,'docs/plan.md')
if (!fs.readFileSync(planFile, 'utf8').includes('### 2026-10-07 设计系统交付验证完成')) fs.appendFileSync(planFile,'\n### 2026-10-07 设计系统交付验证完成\n- [x] CSS语法、全部变量、四主题回退/运行时桥接、自定义色、减少动画与文档引用验证通过。\n- [x] raw、来源文件及已有截图摘要未变；临时浏览器profile已清理。\n- 结果：docs/qa/design-system-20261007/verification.md与verification-results.json；规范与tokens在output。\n')
console.log(JSON.stringify({passed:true,tokens:definitions.size,checkedLinks:checkedLinks.length,rawUnchanged:true,browserThemeCases:browserResult.standalone.length+browserResult.bridges.length}))
