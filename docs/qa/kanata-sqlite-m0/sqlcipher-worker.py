"""Host-only SQLCipher service. Inputs/keys over stdin; never in argv/logs.
One connection, parameter binding for every user value, bounded result pages.
This is NOT the Capacitor Android plugin and does not replace its validation.
"""
import sys, json, time, resource, hashlib, os
from sqlcipher3 import dbapi2 as sqlite

conn = None
db_path = None
key_hex = None
SCOPE = "world_id=? AND conversation_id=?"
PAGE = "SELECT payload FROM qa_messages WHERE " + SCOPE
ORDER = " ORDER BY created_at DESC,id DESC LIMIT 50"

def open_db():
    global conn
    conn = sqlite.connect(db_path, isolation_level=None, timeout=0.2)
    # Only internally generated 32-byte random raw keys, never arbitrary SQL input.
    assert len(key_hex) == 64 and all(c in '0123456789abcdef' for c in key_hex)
    conn.execute("PRAGMA key=\"x'%s'\"" % key_hex)
    conn.execute('SELECT count(*) FROM sqlite_master').fetchone()
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=FULL')
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA cache_size=-2048')
    conn.execute('PRAGMA wal_autocheckpoint=1000')

def run(req):
    global db_path, key_hex, conn
    op = req['op']
    if op == 'init':
        db_path, key_hex = req['path'], req['key']
        open_db()
        # Disposable performance shape, not M1 domain schema.
        conn.execute('CREATE TABLE IF NOT EXISTS qa_messages(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,conversation_id TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL)')
        conn.execute('CREATE INDEX IF NOT EXISTS qa_scope_time ON qa_messages(world_id,conversation_id,created_at DESC,id DESC)')
        return {'cipher':conn.execute('PRAGMA cipher_version').fetchone()[0], 'sqlite':conn.execute('select sqlite_version()').fetchone()[0]}
    if op == 'open':
        open_db()
        return True
    if op == 'close':
        conn.close(); conn=None
        return True
    if op == 'insert':
        conn.execute('BEGIN IMMEDIATE')
        try:
            conn.executemany('INSERT INTO qa_messages VALUES(?,?,?,?,?)', [(m['id'],m['worldId'],m['conversationId'],m['createdAt'],json.dumps(m,ensure_ascii=False,separators=(',',':'))) for m in req['messages']])
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK'); raise
        return len(req['messages'])
    if op in ('recent','page'):
        sql, args = PAGE, [req['worldId'],req['conversationId']]
        if req.get('before'):
            b=req['before']; sql+=' AND (created_at,id)<(?,?)'; args += [b['createdAt'],b['id']]
        rows=conn.execute(sql+ORDER,args).fetchall()
        return [json.loads(r[0]) for r in rows]
    if op == 'locate':
        row=conn.execute('SELECT payload FROM qa_messages WHERE '+SCOPE+' AND id=?',(req['worldId'],req['conversationId'],req['id'])).fetchone()
        return json.loads(row[0]) if row else None
    if op == 'update':
        conn.execute('BEGIN IMMEDIATE')
        try:
            m=run({**req,'op':'locate'}); assert m is not None
            m['content']=req['content']; m['revision']+=1
            conn.execute('UPDATE qa_messages SET payload=? WHERE '+SCOPE+' AND id=?',(json.dumps(m,ensure_ascii=False,separators=(',',':')),req['worldId'],req['conversationId'],req['id']))
            conn.execute('COMMIT')
        except Exception:
            conn.execute('ROLLBACK'); raise
        return True
    if op == 'delete':
        conn.execute('DELETE FROM qa_messages WHERE '+SCOPE+' AND id=?',(req['worldId'],req['conversationId'],req['id']))
        return True
    if op == 'count':
        return conn.execute('SELECT count(*) FROM qa_messages WHERE '+SCOPE,(req['worldId'],req['conversationId'])).fetchone()[0]
    if op == 'integrity':
        return {'integrity':conn.execute('PRAGMA integrity_check').fetchall(), 'cipher_integrity':conn.execute('PRAGMA cipher_integrity_check').fetchall(), 'journal':conn.execute('PRAGMA journal_mode').fetchone()[0]}
    if op == 'plan':
        return conn.execute('EXPLAIN QUERY PLAN '+PAGE+' AND (created_at,id)<(?,?)'+ORDER,(req['worldId'],req['conversationId'],req['createdAt'],req['id'])).fetchall()
    if op == 'proof':
        # VM instructions reveal a full scan hidden behind LIMIT. No payloads retained.
        ticks=[0]
        def tick(): ticks[0]+=1; return 0
        conn.set_progress_handler(tick,1)
        rows=run({**req,'op':'page'})
        conn.set_progress_handler(None,0)
        return {'rows':len(rows),'vmInstructions':ticks[0]}
    raise ValueError('QA_UNKNOWN_OP')

for line in sys.stdin:
    started=time.process_time_ns()
    try:
        result=run(json.loads(line))
        response={'ok':True,'value':result}
    except Exception:
        # SQLCipher/provider exceptions may include SQL; never forward their text.
        response={'ok':False,'code':'QA_SQLCIPHER_OPERATION_FAILED'}
    response['cpuUs']=(time.process_time_ns()-started)//1000
    response['maxRssKiB']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    print(json.dumps(response,ensure_ascii=False),flush=True)
