"""
HTTP helpers and the firmware catalogues the ingest scripts read.

    get / get_json        urlopen with retries and backoff
    open_zip(url)         a remote zip (an IPSW), read by HTTP range requests
    ipsw_me / appledb     api.ipsw.me/v4 and api.appledb.dev/ios, parsed JSON
    iphone_ipsws(entry)   device -> IPSW URL from an AppleDB firmware record
    product_key(id)       sort key for product ids: iPhone9,1 < iPhone10,1
"""

import io
import json
import re
import time
import urllib.error
import urllib.request
import zipfile

UA = {"User-Agent": "carrier-explode"}


def get(url: str, headers: dict | None = None, method: str = "GET", tries: int = 5, timeout: float = 60):
    """urlopen with retries and backoff; 404 is final."""
    req = urllib.request.Request(url, headers={**UA, **(headers or {})}, method=method)
    for attempt in range(tries):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)


def get_json(url: str):
    with get(url) as r:
        return json.load(r)


class RangeFile(io.RawIOBase):
    """A remote file, read by HTTP range requests."""

    def __init__(self, url: str):
        self.url, self.pos = url, 0
        with get(url, method="HEAD") as r:
            self.size = int(r.headers["Content-Length"])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=io.SEEK_SET):
        self.pos = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence] + off
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size or not len(b):
            return 0
        end = min(self.pos + len(b), self.size) - 1
        with get(self.url, {"Range": f"bytes={self.pos}-{end}"}) as r:
            data = r.read()
        b[:len(data)] = data
        self.pos += len(data)
        return len(data)


def open_zip(url: str) -> zipfile.ZipFile:
    """Only the directory and the members read are downloaded."""
    return zipfile.ZipFile(io.BufferedReader(RangeFile(url), buffer_size=1 << 20))


def ipsw_me(path: str):
    return get_json("https://api.ipsw.me/v4" + path)


def appledb(path: str):
    return get_json("https://api.appledb.dev/ios/" + path)


def iphone_ipsws(entry: dict) -> dict[str, str]:
    """iPhone -> IPSW URL in an AppleDB firmware record (iOS;<build>.json)."""
    return {d: v["ipsw"] for d, v in (entry.get("devices") or {}).items()
            if d.startswith("iPhone") and isinstance(v, dict) and v.get("ipsw")}


def product_key(product: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", product)]
