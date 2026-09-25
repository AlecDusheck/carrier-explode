import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from package_system_bundles import attach_baseband


class AttachBaseband(unittest.TestCase):
    def test_stores_the_package_like_a_bundle(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "Mav.bbfw").write_bytes(b"PK\x03\x04 package")
            (d / "summary.json").write_text('{"schema":1}')
            index = {"build": "24A437", "carriers": {}, "countries": {}}
            files = attach_baseband(index, d / "Mav.bbfw", d / "summary.json", d / "out")

            bid = hashlib.sha256(b"PK\x03\x04 package").hexdigest()
            self.assertEqual(index["baseband"], {"id": bid, "size": 12, "name": "Mav.bbfw"})
            self.assertEqual([p.relative_to(d / "out").as_posix() for p in files],
                             [f"blobs/{bid}.bbfw", "system/24A437/baseband.json", "system/24A437/index.json"])
            self.assertEqual(json.loads(files[2].read_text())["baseband"]["id"], bid)
            self.assertEqual(files[1].read_text(), '{"schema":1}')

    def test_same_package_twice_is_one_blob(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "a.bbfw").write_bytes(b"same")
            (d / "s.json").write_text("{}")
            for build in ("A", "B"):
                attach_baseband({"build": build}, d / "a.bbfw", d / "s.json", d / "out")
            self.assertEqual(len(list((d / "out" / "blobs").iterdir())), 1)


if __name__ == "__main__":
    unittest.main()
