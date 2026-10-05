"""Builds the test databases with Python's sqlite3 module: python3 make.py"""
import os
import sqlite3


def fresh(name, *pragmas):
    if os.path.exists(name):
        os.remove(name)
    db = sqlite3.connect(name)
    for p in pragmas:
        db.execute(p)
    return db


db = fresh("main.db", "PRAGMA page_size = 512")
db.execute("CREATE TABLE kinds (id INTEGER PRIMARY KEY, label TEXT NOT NULL, v)")
values = [
    ("null", None), ("zero", 0), ("one", 1), ("int8", -128), ("int16", 32767), ("int24", -8388608),
    ("int32", 2147483647), ("int48", -(2**47)), ("int64", 2**62 + 1), ("int64min", -(2**63)),
    ("real", -2.5), ("text", "héllo, wörld"), ("empty text", ""), ("blob", b"\x00\xff\x10"), ("empty blob", b""),
]
db.executemany("INSERT INTO kinds (id, label, v) VALUES (?, ?, ?)", [(i + 10, l, v) for i, (l, v) in enumerate(values)])
db.execute("CREATE TABLE big (body TEXT, data BLOB)")
db.execute("INSERT INTO big VALUES (?, ?)", ("x" * 3000, bytes(i % 251 for i in range(20000))))
db.execute("INSERT INTO big VALUES (?, ?)", ("short", b"\x01"))
db.execute("CREATE TABLE many (n INTEGER NOT NULL, s TEXT NOT NULL)")
db.executemany("INSERT INTO many VALUES (?, ?)", [(n, f"row {n:05d}") for n in range(5000)])
db.execute('''CREATE TABLE "odd table"
  ("col one" TEXT CHECK ("col one" not glob "*[^0-9,]*") DEFAULT "%",
   [col,two] INTEGER, -- a comment, with a comma
   `three` REAL,
   PRIMARY KEY ("col one"))''')
db.execute('INSERT INTO "odd table" VALUES (?, ?, ?)', ("1,2", 7, 4))
db.execute("CREATE TABLE keyed (k INTEGER, v TEXT, PRIMARY KEY (k ASC))")
db.execute("INSERT INTO keyed VALUES (42, 'answer')")
db.execute("CREATE INDEX many_s ON many (s)")
db.commit()
db.close()

for enc in ("UTF-16le", "UTF-16be"):
    db = fresh(f"{enc.lower()}.db", "PRAGMA page_size = 512", f"PRAGMA encoding = '{enc}'")
    db.execute("CREATE TABLE t (s TEXT)")
    db.execute("INSERT INTO t VALUES ('Grüße 日本')")
    db.commit()
    db.close()
