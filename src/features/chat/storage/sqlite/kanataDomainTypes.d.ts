export type KanataSqliteDomains = ReturnType<typeof import('./kanataSqliteDomains.js').createKanataSqliteDomains>
export interface KanataSqliteDomainOwner {
  readonly worldId: string
  assertCurrent(): void
}
