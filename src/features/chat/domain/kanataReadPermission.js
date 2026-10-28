// @ts-check
/** A lazy reader cannot be called before world/instance/module permission is checked.
 * P4 supplies no real-life readers; P5 will add per-module projections and grant UI.
 * read never implies remember/share, and a group additionally requires share.
 * @template T
 * @param {import('./kanataTypes').KanataData} data
 * @param {{worldId:string,instanceId:string,moduleId:import('./kanataTypes').LifeModule,group:boolean}} scope
 * @param {()=>T} reader
 * @returns {{allowed:false}|{allowed:true,value:T}}
 */
export function readKanataAuthorizedLifeData(data,scope,reader) {
  const world=data.worlds.find(w=>w.id===scope.worldId)
  const instance=data.instances.find(i=>i.id===scope.instanceId&&i.worldId===scope.worldId)
  if(!world||world.archived||!instance)return{allowed:false}
  const grant=data.lifeGrants.find(g=>g.worldId===scope.worldId&&g.instanceId===scope.instanceId&&g.moduleId===scope.moduleId)
  if(!grant?.read||(scope.group&&!grant.share))return{allowed:false}
  return{allowed:true,value:reader()}
}
