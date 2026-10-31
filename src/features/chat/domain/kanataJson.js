// @ts-check
/** Stable codes, with structural paths only; never echo private input in errors. */
export class KanataValidationError extends Error {
  /** @param {string} code @param {string} path */
  constructor(code, path) { super(code + ':' + path); this.name = 'KanataValidationError'; this.code = code; this.path = path }
}
/** @param {unknown} condition @param {string} code @param {string} path */
export function requireKanata(condition, code, path) {
  if (!condition) throw new KanataValidationError(code, path)
}
/** Shared traversal; validation-only mode does not expose or detach its input.
 * @param {unknown} value @param {boolean} copy @returns {unknown}
 */
function walkKanataJson(value, copy) {
  /** @type {Set<object>} */
  const stack = new Set()
  // One private output descriptor for this synchronous traversal. Its value never escapes
  // through the descriptor itself; defineProperty copies it into a new data property.
  /** @type {PropertyDescriptor|null} */
  const definition=copy?{value:undefined,enumerable:true,writable:true,configurable:true}:null
  /** @param {unknown} item @param {number} depth @returns {unknown} */
  const visit = (item, depth) => {
    requireKanata(depth <= 64, 'JSON_TOO_DEEP', 'data')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number') { requireKanata(Number.isFinite(item), 'INVALID_JSON_NUMBER', 'data'); return Object.is(item, -0) ? 0 : item }
    requireKanata(typeof item === 'object' && item !== null, 'INVALID_JSON_VALUE', 'data')
    const obj = /** @type {object} */(item)
    requireKanata(!stack.has(obj), 'CYCLIC_JSON', 'data')
    requireKanata(Array.isArray(obj) || Object.getPrototypeOf(obj) === Object.prototype || Object.getPrototypeOf(obj) === null, 'INVALID_JSON_OBJECT', 'data')
    requireKanata(Object.getOwnPropertySymbols(obj).length === 0, 'INVALID_JSON_VALUE', 'data')
    stack.add(obj)
    const array=Array.isArray(obj)
    const names = Object.getOwnPropertyNames(obj)
    const result = copy ? (array ? [] : {}) : null
    for (const key of names) {
      if (array && key === 'length') continue
      const d = /** @type {PropertyDescriptor} */(Object.getOwnPropertyDescriptor(obj,key))
      requireKanata(d && Object.hasOwn(d, 'value') && d.enumerable, 'INVALID_JSON_PROPERTY', 'data')
      // Define a data property, including __proto__; never invoke an inherited setter.
      const child=visit(d.value,depth+1)
      if(result&&definition){definition.value=child;Object.defineProperty(result,key,definition);definition.value=undefined}
    }
    if (array) {
      const keys=names.filter(key=>key!=='length')
      requireKanata(keys.length === obj.length && keys.every((key, index) => key === String(index)), 'INVALID_JSON_ARRAY', 'data')
    }
    stack.delete(obj)
    return result
  }
  return visit(value, 0)
}
/** Detached inert JSON; immutable strings need no giant serialized temporary.
 * @template T @param {T} value @returns {T} */
export function cloneKanataJson(value) {return /** @type {T} */(walkKanataJson(value,true))}
/** Checks inert JSON without copying; callers must still clone untrusted/external values before ownership transfer.
 * @param {unknown} value */
export function assertKanataJson(value) {walkKanataJson(value,false)}
