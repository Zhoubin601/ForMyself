// @ts-check

/** @param {import('../../../../platform/storage/kanataSqliteTypes').KanataSqliteOperation} operation
 * @returns {import('./kanataSchemaTypes').KanataSchemaConnection} */
export function kanataSchemaAdapter(operation) {
  return {
    transaction: action => operation.transaction(tx => action({
      query: tx.query,
      execute: async (sql, parameters) => { await tx.execute(sql, parameters) },
    })),
  }
}
