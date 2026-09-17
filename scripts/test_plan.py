import unittest
from plan_system_bundles import plan

fw = lambda v, b, d="iPhone17,1": {"version": v, "buildid": b, "identifier": d}
P = [fw("27.0", "24A437"), fw("26.6.2", "23G90"), fw("26.6.1", "23G83"), fw("26.4", "23E246"), fw("26.0", "23A341")]


class Plan(unittest.TestCase):
    def test_takes_every_missing_release_not_just_latest(self):
        got = plan([{"version": "26.4"}], P, [], None, 9)
        self.assertEqual([x["version"] for x in got], ["26.6.1", "26.6.2", "27.0"])

    def test_never_goes_below_the_oldest_held_image(self):
        self.assertNotIn("26.0", [x["version"] for x in plan([{"version": "26.4"}], P, [], None, 9)])

    def test_cap_keeps_the_oldest_missing_so_history_fills_in_order(self):
        self.assertEqual([x["version"] for x in plan([{"version": "26.4"}], P, [], None, 2)], ["26.6.1", "26.6.2"])

    def test_empty_bucket_takes_only_the_newest(self):
        self.assertEqual([x["version"] for x in plan([], P, [], None, 3)], ["27.0"])

    def test_nothing_to_do(self):
        self.assertEqual(plan([{"version": v["version"]} for v in P], P, [], None, 3), [])

    def test_explicit_version_ignores_held_and_floor(self):
        self.assertEqual(plan([{"version": "26.4"}], P, [], "26.0", 3), [{"version": "26.0", "build": "23A341", "device": "iPhone17,1"}])

    def test_falls_back_to_a_newer_device_only_for_releases_the_preferred_one_lacks(self):
        newer = [fw("28.0", "25A1", "iPhone19,7"), fw("27.0", "24A999", "iPhone19,7")]
        got = {x["version"]: x for x in plan([{"version": "26.6.2"}], P, newer, None, 9)}
        self.assertEqual(got["28.0"]["device"], "iPhone19,7")
        self.assertEqual((got["27.0"]["device"], got["27.0"]["build"]), ("iPhone17,1", "24A437"))

    def test_orders_versions_numerically(self):
        got = plan([{"version": "9.3"}], [fw("10.0", "a"), fw("9.3.5", "b")], [], None, 9)
        self.assertEqual([x["version"] for x in got], ["9.3.5", "10.0"])


if __name__ == "__main__":
    unittest.main()
