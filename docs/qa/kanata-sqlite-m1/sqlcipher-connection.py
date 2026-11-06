"""Isolated M1 host QA connection. No key in argv, output or disk metadata.
Only the parent test runner sends SQL; this is not an application Driver.
"""
import json
import os
import pathlib
import shutil
import sys
import tempfile
from sqlcipher3 import dbapi2 as sqlite

root = pathlib.Path(tempfile.mkdtemp(prefix='m1-cipher-', dir='work/m0'))
database = root / 'synthetic.db'
key = bytearray(os.urandom(32))
connection = None

def open_connection():
    result = sqlite.connect(str(database), isolation_level=None)
    result.execute('PRAGMA key="x\'%s\'"' % key.hex())
    result.execute('PRAGMA foreign_keys=ON')
    result.execute('PRAGMA journal_mode=WAL')
    result.execute('PRAGMA synchronous=FULL')
    result.row_factory = sqlite.Row
    return result

try:
    connection = open_connection()
    for line in sys.stdin:
        try:
            request = json.loads(line)
            operation = request['operation']
            if operation == 'reopen':
                connection.close()
                connection = open_connection()
                value = True
            elif operation == 'encrypted':
                value = database.read_bytes()[:16] != b'SQLite format 3\x00'
            else:
                cursor = connection.execute(request['sql'], request.get('parameters', []))
                value = [dict(row) for row in cursor.fetchall()] if operation == 'query' else None
            response = {'ok': True, 'value': value}
        except Exception:
            response = {'ok': False, 'code': 'QA_SQL_FAILURE'}
        print(json.dumps(response, ensure_ascii=False), flush=True)
finally:
    if connection is not None:
        connection.close()
    for i in range(len(key)):
        key[i] = 0
    shutil.rmtree(root)
