import {connect,pause,uiSet} from '../background-20261019/native/cdp.mjs'
process.env.QA_CDP_PORT='9362';const c=await connect()
await c.evaluate(`(()=>{window.__qaPointers=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.querySelector('.background-crop-frame').addEventListener(type,e=>window.__qaPointers.push({type:e.type,id:e.pointerId,x:e.clientX,y:e.clientY}));return true})()`)
const touch=async(type,points)=>c.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:3,radiusY:3,force:1}))})
try{await touch('touchCancel',[])}catch{}
await c.evaluate(uiSet('#background-crop-zoom','1.5'))
const p=await c.evaluate(`(()=>{const r=document.querySelector('.background-crop-frame').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
await touch('touchStart',[[1,p.x-25,p.y],[2,p.x+25,p.y]])
await touch('touchMove',[[1,p.x-40,p.y],[2,p.x+40,p.y]])
await touch('touchEnd',[[1,p.x-40,p.y]])
await touch('touchMove',[[1,p.x+10,p.y+10]])
await pause(100)
console.log(await c.evaluate('window.__qaPointers'))
await touch('touchCancel',[]);c.close()
