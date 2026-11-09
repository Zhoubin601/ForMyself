"""QA-only SQLCipher connection. Synthetic path/key arrive only on stdin.
Never echo SQL, parameters, key or provider exceptions. Parent owns its mkdtemp.
"""
import json
import pathlib
import sys
import sqlite3 as plain
from sqlcipher3 import dbapi2 as cipher

connection = None
database = None
try:
    for line in sys.stdin:
        try:
            r = json.loads(line)
            if r['operation'] == 'init':
                if connection is not None:
                    raise ValueError()
                database = pathlib.Path(r['path']).resolve()
                base = pathlib.Path('work/m0').resolve()
                if not database.is_relative_to(base) or not database.parent.name.startswith('m1-r-cipher-') or database.name != 'synthetic.db':
                    raise ValueError()
                key = r['key']
                if len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
                    raise ValueError()
                connection = cipher.connect(str(database), isolation_level=None)
                connection.execute('PRAGMA key="x\'%s\'"' % key)
                key = None
                connection.execute('SELECT count(*) FROM sqlite_schema').fetchone()
                connection.execute('PRAGMA foreign_keys=ON')
                connection.execute('PRAGMA journal_mode=WAL')
                connection.execute('PRAGMA synchronous=FULL')
                connection.row_factory = cipher.Row
                value = {'cipher': connection.execute('PRAGMA cipher_version').fetchone()[0], 'sqlite': cipher.sqlite_version}
            elif r['operation'] == 'plain-rejected':
                p = plain.connect('file:' + str(database) + '?mode=ro', uri=True)
                try:
                    p.execute('SELECT count(*) FROM sqlite_schema').fetchone()
                    value = False
                except plain.DatabaseError:
                    value = True
                finally:
                    p.close()
            else:
                cursor = connection.execute(r['sql'], r.get('parameters', []))
                if r['operation'] == 'query':
                    value = [dict(row) for row in cursor.fetchall()]
                elif r['operation'] == 'write':
                    value = {'affectedRows': connection.execute('SELECT changes()').fetchone()[0]}
                else:
                    value = None
            response = {'ok': True, 'value': value}
        except Exception:
            response = {'ok': False, 'code': 'QA_SQLCIPHER_FAILED'}
        print(json.dumps(response, ensure_ascii=False), flush=True)
finally:
    if connection is not None:
        connection.close()
