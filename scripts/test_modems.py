import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as Z

from modems import contract, group, modem_members, modems_of, plan, plan_rebuild, read_meta, rewrite, split, stored

zi = lambda name, size, crc: Z(filename=name, file_size=size, CRC=crc)
MAV24 = zi("Firmware/Mav24-3.02.02.Release.bbfw", 114158255, 0x87670AE3)
MAV25 = zi("Firmware/Mav25-2.10.01.Release.bbfw", 137531115, 0xADE9FCA3)
C1 = zi("Firmware/c4000v59/Release/patched/ftab.bin", 208967425, 0x912E2E46)
ROSE = zi("Firmware/Rose/r2p1/ftab.bin", 1069076, 0x36EF021F)
T2026 = zi("Firmware/t2026phoneG1/Release/ftab.bin", 29455088, 0x0A662AA0)



def manifest(**boards):
    """BuildManifest.plist with one identity per board: {board: [(manifest key, IPSW path)]}."""
    return {"BuildIdentities": [{"Info": {"DeviceClass": b}, "Manifest": {k: {"Info": {"Path": p}} for k, p in ents}}
                                for b, ents in boards.items()]}


ROSE_KEYS = [("Rap,RTKitOS", ROSE.filename)]
WIFI_KEYS = [("Wireless1,WiFiTx", T2026.filename)]
BB = lambda z: [("BasebandFirmware", z.filename), *ROSE_KEYS]
CELL = lambda z: [("Cellular1,RTKitOS", z.filename), ("Cellular1,LLB", z.filename), *ROSE_KEYS]

# 24A437 as its IPSW directories list it: one IPSW per phone, and one shared by two
# phones with different modems (as betas ship for iPhone19,2/19,3).
IPSWS = {"u/17,1": ["iPhone17,1"], "u/17,3": ["iPhone17,3"], "u/17,5": ["iPhone17,5"],
         "u/18,1": ["iPhone18,1", "iPhone18,4"]}
BOARDS = {"iPhone17,1": ["d93ap"], "iPhone17,3": ["d47ap"], "iPhone17,5": ["v59ap"], "iPhone18,1": ["v53ap"], "iPhone18,4": ["d23ap"]}
LISTINGS = {"u/17,1": modem_members([MAV24, ROSE], manifest(d93ap=BB(MAV24))),
            "u/17,3": modem_members([MAV24, ROSE], manifest(d47ap=BB(MAV24))),
            "u/17,5": modem_members([ROSE, C1], manifest(v59ap=CELL(C1))),
            "u/18,1": modem_members([MAV25, ROSE, T2026, C1], manifest(v53ap=BB(MAV25) + WIFI_KEYS, d23ap=CELL(C1) + WIFI_KEYS))}


def pkg(name, size, crc32, kind, id_, family):
    return {"name": name, "size": size, "crc32": crc32, "kind": kind, "id": id_, "family": family}


P24 = pkg("Mav24-3.02.02.Release.bbfw", 114158255, "87670ae3", "bbfw", "a" * 64, "Mav24")
P25 = pkg("Mav25-2.10.01.Release.bbfw", 137531115, "ade9fca3", "bbfw", "b" * 64, "Mav25")
PC1 = pkg("c4000v59/Release/patched/ftab.bin", 208967425, "912e2e46", "ftab", "c" * 64, "C1")


def entry(p, devices):
    return {"family": p["family"], "package": {k: p[k] for k in ("id", "size", "name", "crc32", "kind")}, "devices": devices}


class Members(unittest.TestCase):
    def test_only_what_the_manifest_names_as_a_modem(self):
        m = manifest(v53ap=BB(MAV25) + WIFI_KEYS, d23ap=CELL(C1))
        got = modem_members([MAV25, ROSE, T2026, C1, zi("Firmware/all_flash/iBoot.im4p", 1, 1)], m)
        self.assertEqual([(x["name"], x["kind"], x["boards"]) for x in got],
                         [("Mav25-2.10.01.Release.bbfw", "bbfw", ["v53ap"]), ("c4000v59/Release/patched/ftab.bin", "ftab", ["d23ap"])])
        self.assertEqual(got[0]["crc32"], "ade9fca3")
        self.assertEqual(got[1]["member"], "Firmware/c4000v59/Release/patched/ftab.bin")


class Group(unittest.TestCase):
    def test_one_entry_per_package_with_every_phone_newest_first(self):
        got = group(IPSWS, LISTINGS, BOARDS)
        self.assertEqual([(g["name"], g["devices"]) for g in got], [
            ("c4000v59/Release/patched/ftab.bin", ["iPhone17,5", "iPhone18,4"]),
            ("Mav25-2.10.01.Release.bbfw", ["iPhone18,1"]),
            ("Mav24-3.02.02.Release.bbfw", ["iPhone17,1", "iPhone17,3"]),
        ])

    def test_a_phone_with_unknown_boards_gets_every_modem_of_its_ipsw(self):
        got = group(IPSWS, LISTINGS, {k: v for k, v in BOARDS.items() if k != "iPhone18,4"})
        self.assertIn("iPhone18,4", next(g for g in got if g["name"].startswith("Mav25"))["devices"])

    def test_same_name_different_bytes_are_two_packages(self):
        other = zi(MAV24.filename, MAV24.file_size, 0x1)
        got = group({"a": ["iPhone17,1"], "b": ["iPhone17,2"]},
                    {"a": modem_members([MAV24], manifest(d93ap=BB(MAV24))), "b": modem_members([other], manifest(d94ap=BB(other)))}, {})
        self.assertEqual(len(got), 2)


class Plan(unittest.TestCase):
    def test_fetches_only_packages_no_index_points_at(self):
        held = {"23G90": {"build": "23G90", "modems": [entry(P24, ["iPhone17,1"])]}, "24A437": {"build": "24A437", "modems": []}}
        got = plan(held, {"24A437": group(IPSWS, LISTINGS, BOARDS)}, 2)
        names = sorted(p["name"] for leg in got["legs"] for p in leg)
        self.assertEqual(names, ["Mav25-2.10.01.Release.bbfw", "c4000v59/Release/patched/ftab.bin"])
        self.assertEqual({p["url"] for leg in got["legs"] for p in leg}, {"u/17,5", "u/18,1"})
        self.assertEqual(len(got["builds"]["24A437"]), 3)
        self.assertEqual(set(got["builds"]["24A437"][0]), {"name", "size", "crc32", "kind", "devices"})

    def test_a_package_shared_by_builds_is_fetched_once(self):
        got = plan({}, {"A": group(IPSWS, LISTINGS, BOARDS), "B": group(IPSWS, LISTINGS, BOARDS)}, 6)
        self.assertEqual(sum(map(len, got["legs"])), 3)

    def test_rebuild_lists_every_stored_package_once_from_its_blob(self):
        held = {"A": {"modems": [entry(P24, []), entry(P25, [])]}, "B": {"modems": [entry(P24, [])]}}
        got = plan_rebuild(held, 6)
        self.assertEqual(sorted(p["id"] for leg in got["legs"] for p in leg), [P24["id"], P25["id"]])
        self.assertEqual(got["builds"], {})

    def test_split_round_robin_without_empty_legs(self):
        self.assertEqual(split([1, 2, 3], 2), [[1, 3], [2]])
        self.assertEqual(split([1], 6), [[1]])
        self.assertEqual(split([], 6), [])


class Write(unittest.TestCase):
    groups = group(IPSWS, LISTINGS, BOARDS)

    def test_modems_from_stored_and_just_fetched_packages(self):
        known = {**stored({"x": {"modems": [entry(P24, [])]}}), **{(p["name"], p["size"], p["crc32"]): p for p in (P25, PC1)}}
        got = modems_of(self.groups, known)
        self.assertEqual(got, [entry(PC1, ["iPhone17,5", "iPhone18,4"]), entry(P25, ["iPhone18,1"]),
                               entry(P24, ["iPhone17,1", "iPhone17,3"])])

    def test_waits_while_a_package_is_missing(self):
        self.assertIsNone(modems_of(self.groups, stored({"x": {"modems": [entry(P24, [])]}})))

    def test_rewrite_adds_modems_and_keeps_the_rest(self):
        old = {"build": "24A437", "carriers": {"A": 1}, "countries": {}, "baseband": {"id": "a" * 64, "size": 1, "name": "Mav24"}}
        got = rewrite(old, [entry(P24, ["iPhone17,1"])])
        self.assertEqual(got["modems"][0]["family"], "Mav24")
        # Expand only: the old field stays until the contract pass, so the live site keeps working.
        self.assertIn("baseband", got)
        self.assertEqual(got["carriers"], {"A": 1})

    def test_contract_drops_the_one_package_field(self):
        m = [entry(P24, ["iPhone17,1"])]
        self.assertEqual(contract({"build": "A", "modems": m, "baseband": {}}), {"build": "A", "modems": m})
        self.assertIsNone(contract({"build": "A", "modems": m}))

    def test_contract_refuses_an_index_that_was_never_expanded(self):
        with self.assertRaises(SystemExit):
            contract({"build": "A", "baseband": {}})

    def test_rewrite_leaves_an_unchanged_index_alone(self):
        m = [entry(P24, ["iPhone17,1"])]
        self.assertIsNone(rewrite({"build": "A", "modems": m}, m))
        self.assertIsNotNone(rewrite({"build": "A", "modems": []}, m))

    def test_meta_lines_from_every_leg(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "0.jsonl").write_text(json.dumps(P25) + "\n")
            (Path(d) / "1.jsonl").write_text(json.dumps(PC1) + "\n\n")
            self.assertEqual(set(read_meta(Path(d))), {("Mav25-2.10.01.Release.bbfw", 137531115, "ade9fca3"),
                                                        ("c4000v59/Release/patched/ftab.bin", 208967425, "912e2e46")})


if __name__ == "__main__":
    unittest.main()
