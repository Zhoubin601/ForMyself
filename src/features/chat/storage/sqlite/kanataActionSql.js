// @ts-check
// Object spread indexes JavaScript UTF-16 code units. Walk the original JSON
// lexeme as bytes so SQLite never decodes an isolated surrogate into UTF-8.
const bytes = 'substr(bytes,pos,1)'
const escaped = `${bytes}=x'5c'`
const unicodeEscape = `${escaped} AND substr(bytes,pos+1,1)=x'75'`
const hex = (/** @type {number} */ offset) =>
  `(instr('0123456789abcdef',lower(CAST(substr(bytes,pos+${offset},1) AS TEXT)))-1)`
const code = `CASE WHEN ${unicodeEscape} THEN ${hex(2)}*4096+${hex(3)}*256+${hex(4)}*16+${hex(5)}
  WHEN ${escaped} THEN CASE CAST(substr(bytes,pos+1,1) AS TEXT)
    WHEN 'b' THEN 8 WHEN 'f' THEN 12 WHEN 'n' THEN 10 WHEN 'r' THEN 13 WHEN 't' THEN 9
    ELSE unicode(CAST(substr(bytes,pos+1,1) AS TEXT)) END
  ELSE unicode(CAST(substr(bytes,pos,4) AS TEXT)) END`
const unit = (/** @type {string} */ value) =>
  `CASE WHEN (${value}) BETWEEN 55296 AND 57343 THEN printf('"\\u%04x"',${value}) ELSE json_quote(char(${value})) END`

export const stringActionSql = `(WITH RECURSIVE raw(bytes) AS MATERIALIZED (
    SELECT CAST((e.extensions_json -> '$.action') AS BLOB)
  ), walk(pos,idx,part) AS (
    VALUES(2,0,NULL)
    UNION ALL SELECT pos+CASE WHEN ${unicodeEscape} THEN 6 WHEN ${escaped} THEN 2
      WHEN (${code})<128 THEN 1 WHEN (${code})<2048 THEN 2 WHEN (${code})<65536 THEN 3 ELSE 4 END,
      idx+CASE WHEN (${code})>65535 THEN 2 ELSE 1 END,
      '"'||idx||'":'||CASE WHEN (${code})>65535
        THEN ${unit('55296+(('+code+'-65536)>>10)')}||',"'||(idx+1)||'":'||${unit('56320+(('+code+'-65536)&1023)')}
        ELSE ${unit(code)} END
    FROM walk CROSS JOIN raw WHERE pos<length(bytes)
  ) SELECT '{'||coalesce(group_concat(part,','),'')||'}' FROM (SELECT part FROM walk ORDER BY pos))`
