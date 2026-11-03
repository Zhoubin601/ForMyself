export type ArchiveFileCommand = {operation:'read'|'delete';key:string}|{operation:'write';key:string;data:string}
export type ArchiveFileResult = {ok:false}|{ok:true;data?:string;oversized?:boolean}
export interface ArchiveFileBatchDriver {
  execute(options:{operations:ArchiveFileCommand[]}):Promise<{results:ArchiveFileResult[]}>
}
/** Minimal existing file contract; no feature Store or application state enters this adapter. */
export interface ArchiveFilesystemDriver {
  stat(options:{path:string;directory:string}):Promise<unknown>
  readFile(options:{path:string;directory:string;encoding:string}):Promise<{data:string|Blob}>
  writeFile(options:{path:string;directory:string;encoding:string;data:string}):Promise<unknown>
  mkdir(options:{path:string;directory:string;recursive:boolean}):Promise<unknown>
  readdir(options:{path:string;directory:string}):Promise<{files:{name:string;type:string;size?:number}[]}>
  deleteFile(options:{path:string;directory:string}):Promise<unknown>
  /** Optional bounded retirement of this fixed hash namespace, after canonical commit. */
  deleteArchiveKeys?(keys:string[]):Promise<void>
  rename(options:{from:string;to:string;directory:string;toDirectory:string}):Promise<unknown>
}
