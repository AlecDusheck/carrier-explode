import io
import unittest
import urllib.error
import zipfile
from unittest import mock

import net


def served(data: bytes):
    """A stand-in for net.get that answers HEAD and Range requests from `data`."""
    calls = []

    def get(url, headers=None, method="GET", **_):
        calls.append((method, (headers or {}).get("Range")))
        if method == "HEAD":
            r = io.BytesIO()
            r.headers = {"Content-Length": str(len(data))}
            return r
        start, end = map(int, headers["Range"].removeprefix("bytes=").split("-"))
        return io.BytesIO(data[start:end + 1])

    return get, calls


def zipped(**members: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in members.items():
            z.writestr(name, body)
    return buf.getvalue()


class RangeFile(unittest.TestCase):
    def test_open_zip_reads_members_over_ranges(self):
        body = bytes(range(256)) * 4096
        get, calls = served(zipped(**{"BuildManifest.plist": b"<plist/>", "Firmware/Mav25.bbfw": body}))
        with mock.patch.object(net, "get", get), net.open_zip("https://example/x.ipsw") as z:
            self.assertEqual(z.read("Firmware/Mav25.bbfw"), body)
            self.assertEqual(z.read("BuildManifest.plist"), b"<plist/>")
        self.assertEqual(calls[0], ("HEAD", None))
        self.assertTrue(all(r.startswith("bytes=") for m, r in calls[1:]))

    def test_seek_and_read_past_the_end(self):
        get, _ = served(b"0123456789")
        with mock.patch.object(net, "get", get):
            f = net.RangeFile("https://example/f")
            self.assertEqual(f.seek(-3, io.SEEK_END), 7)
            self.assertEqual(f.read(10), b"789")
            self.assertEqual(f.read(1), b"")
            f.seek(2)
            self.assertEqual(f.seek(3, io.SEEK_CUR), 5)
            self.assertEqual(f.read(2), b"56")


class Get(unittest.TestCase):
    def http_error(self, code):
        return urllib.error.HTTPError("https://example", code, "", {}, None)

    @mock.patch("time.sleep")
    def test_retries_then_succeeds(self, sleep):
        ok = io.BytesIO(b"{}")
        with mock.patch("urllib.request.urlopen", side_effect=[self.http_error(503), TimeoutError(), ok]) as urlopen:
            self.assertIs(net.get("https://example"), ok)
        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [1, 2])
        self.assertEqual(urlopen.call_args.args[0].get_header("User-agent"), "carrier-explode")

    @mock.patch("time.sleep")
    def test_404_is_final(self, sleep):
        with mock.patch("urllib.request.urlopen", side_effect=self.http_error(404)) as urlopen:
            with self.assertRaises(urllib.error.HTTPError):
                net.get("https://example")
        self.assertEqual(urlopen.call_count, 1)
        sleep.assert_not_called()

    @mock.patch("time.sleep")
    def test_gives_up_after_the_last_try(self, _):
        with mock.patch("urllib.request.urlopen", side_effect=ConnectionError()) as urlopen:
            with self.assertRaises(ConnectionError):
                net.get("https://example", tries=3)
        self.assertEqual(urlopen.call_count, 3)


class Catalogue(unittest.TestCase):
    def test_product_key_orders_numerically(self):
        ids = ["iPhone10,1", "iPhone9,3", "iPhone17,5", "iPhone17,10"]
        self.assertEqual(sorted(ids, key=net.product_key), ["iPhone9,3", "iPhone10,1", "iPhone17,5", "iPhone17,10"])

    def test_iphone_ipsws_keeps_iphones_with_a_link(self):
        entry = {"devices": {
            "iPhone18,1": {"ipsw": "https://updates.cdn-apple.com/a.ipsw"},
            "iPhone18,2": {},
            "iPhone18,3": "iPhone18,1",
            "iPad16,1": {"ipsw": "https://updates.cdn-apple.com/b.ipsw"},
        }}
        self.assertEqual(net.iphone_ipsws(entry), {"iPhone18,1": "https://updates.cdn-apple.com/a.ipsw"})
        self.assertEqual(net.iphone_ipsws({"devices": None}), {})


if __name__ == "__main__":
    unittest.main()
