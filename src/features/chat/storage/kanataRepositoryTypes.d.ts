import type {ArchiveFilesystemDriver} from '../../../platform/storage/archiveFileBatchTypes'
export interface KanataFilesystem extends ArchiveFilesystemDriver {}
export interface KanataJournal {
  get(options: {key: string}): Promise<{value: string | null}>
  set(options: {key: string; value: string}): Promise<unknown>
  remove(options: {key: string}): Promise<unknown>
}
import type { KanataData } from '../domain/kanataTypes'

export type KanataReadResult =
  | {status: 'missing'; data: null; fingerprint: string; recovered: false}
  | {status: 'ready' | 'recovered'; data: KanataData; fingerprint: string; recovered: boolean}
