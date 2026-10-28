export interface KanataFilesystem {
  stat(options: {path: string; directory: string}): Promise<unknown>
  readFile(options: {path: string; directory: string; encoding: string}): Promise<{data: string | Blob}>
  writeFile(options: {path: string; directory: string; encoding: string; data: string}): Promise<unknown>
  mkdir(options: {path: string; directory: string; recursive: boolean}): Promise<unknown>
  deleteFile(options: {path: string; directory: string}): Promise<unknown>
  rename(options: {from: string; to: string; directory: string; toDirectory: string}): Promise<unknown>
}
export interface KanataJournal {
  get(options: {key: string}): Promise<{value: string | null}>
  set(options: {key: string; value: string}): Promise<unknown>
  remove(options: {key: string}): Promise<unknown>
}
import type { KanataData } from '../domain/kanataTypes'

export type KanataReadResult =
  | {status: 'missing'; data: null; fingerprint: string; recovered: false}
  | {status: 'ready' | 'recovered'; data: KanataData; fingerprint: string; recovered: boolean}
