"""Real Linux SQLCipher encryption/failure tests, NOT Android validation."""
import os, json, tempfile, sqlite3, signal, time, multiprocessing, pathlib, resource
from sqlcipher3 import dbapi2 as cipher

def connect(p,key):
    c=cipher.connect(str(p),isolation_level=None,timeout=0.05)
    assert len(key)==32
    c.execute('PRAGMA cipher_log_level=NONE')
    c.execute('PRAGMA key="x\'%s\'"' % key.hex())
    c.execute('select count(*) from sqlite_master').fetchone()
    return c

def writer(p,key,ready):
    c=connect(p,key)
    c.execute('INSERT INTO qa VALUES(3,?)',('committed-before-kill',))
    c.execute('BEGIN IMMEDIATE')
    c.execute('INSERT INTO qa VALUES(4,?)',('must-rollback-after-kill',))
    ready.send(True)
    signal.pause()

def main():
    root=pathlib.Path(tempfile.mkdtemp(prefix='cipher-proof-',dir='work/m0'))
    runs=[]
    for trial in range(5):
        key=os.urandom(32); p=root / ('qa-%d.db'%trial); marker='M0-SYNTHETIC-MARKER-'+os.urandom(16).hex()
        start=time.perf_counter(); c=connect(p,key)
        version=c.execute('PRAGMA cipher_version').fetchone()[0]
        assert c.execute('PRAGMA journal_mode=WAL').fetchone()[0]=='wal'
        c.execute('PRAGMA synchronous=FULL')
        c.execute('CREATE TABLE qa(id INTEGER PRIMARY KEY,body TEXT)')
        c.execute('BEGIN IMMEDIATE');c.executemany('INSERT INTO qa VALUES(?,?)',[(1,marker),(2,'synthetic')]);c.execute('COMMIT')
        c.execute('BEGIN IMMEDIATE');c.execute('INSERT INTO qa VALUES(99,?)',('rolled back',));c.execute('ROLLBACK')
        assert c.execute('select count(*) from qa').fetchone()[0]==2
        c2=connect(p,key);c.execute('BEGIN IMMEDIATE')
        locked=False
        try:c2.execute('INSERT INTO qa VALUES(77,?)',('blocked concurrent writer',))
        except cipher.OperationalError:locked=True
        assert locked;c.execute('ROLLBACK');c2.close()
        for file in (p,p.with_name(p.name+'-wal'),p.with_name(p.name+'-shm')):
            if file.exists():
                wire=file.read_bytes();assert marker.encode() not in wire;assert key not in wire;assert key.hex().encode() not in wire
        wal=p.with_name(p.name+'-wal').stat().st_size
        c.close()
        wrong=False
        try:connect(p,os.urandom(32))
        except cipher.DatabaseError:wrong=True
        assert wrong
        plain=False
        ordinary=sqlite3.connect(str(p))
        try:ordinary.execute('select * from qa').fetchall()
        except sqlite3.DatabaseError:plain=True
        finally:ordinary.close()
        assert plain;assert not p.read_bytes().startswith(b'SQLite format 3')
        for _ in range(5):
            c=connect(p,key);assert c.execute('select body from qa where id=1').fetchone()[0]==marker;c.close()
        receiver,sender=multiprocessing.Pipe(False)
        child=multiprocessing.Process(target=writer,args=(p,key,sender));child.start()
        assert receiver.poll(10);assert receiver.recv()
        os.kill(child.pid,signal.SIGKILL);child.join(10);assert child.exitcode==-signal.SIGKILL
        c=connect(p,key)
        assert c.execute('select count(*) from qa where id=3').fetchone()[0]==1
        assert c.execute('select count(*) from qa where id=4').fetchone()[0]==0
        assert c.execute('pragma integrity_check').fetchall()==[('ok',)]
        assert c.execute('pragma cipher_integrity_check').fetchall()==[]
        c.execute('UPDATE qa SET body=? WHERE id=?',('edited',2));c.execute('DELETE FROM qa WHERE id=?',(2,))
        assert c.execute('select count(*) from qa').fetchone()[0]==2;c.close()
        runs.append({'trial':trial,'ms':(time.perf_counter()-start)*1000,'walBytesDuringWrite':wal,'dbBytesAfterClose':p.stat().st_size,'correctKey':True,'wrongKeyRejected':True,'plainSQLiteRejected':True,'plaintextAndRawKeyAbsentFromDB_WAL_SHM':True,'rollback':True,'concurrentWriterBusy':True,'reopen5':True,'sigkillCommitPreservedUncommittedRolledBack':True,'integrity':'ok','cipherIntegrity':[]})
    print(json.dumps({'status':'PASS_HOST_ONLY','cipherVersion':version,'sqliteVersion':cipher.sqlite_version,'androidCipherVersion':'4.17.0 NOT RUN','samples':5,'peakRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'runs':runs},indent=2))

if __name__=='__main__': main()
