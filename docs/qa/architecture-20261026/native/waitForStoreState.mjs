// JS Playwright treats a string as an expression, so predicates must be invoked explicitly.
export function waitForStoreState(page, storeExpression, body, options = {}) {
  return page.waitForFunction(`(() => {
    const stores = ${storeExpression};
    const value = (() => { ${body} })();
    if (typeof value === 'function') throw Error('A state predicate must return a value');
    return Boolean(value);
  })()`, null, { timeout:120000, ...options })
}
