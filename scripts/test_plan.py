import unittest
from plan_system_bundles import beta_candidates, missing_baseband, plan, plan_betas
from versions import merge, version_key

fw = lambda v, b, d="iPhone17,1": {"version": v, "buildid": b, "identifier": d}
P = [fw("27.0", "24A437"), fw("26.6.2", "23G90"), fw("26.6.1", "23G83"), fw("26.4", "23E246"), fw("26.0", "23A341")]


def held(*versions):
    by = {f["version"]: f for f in P}
    return [{"version": v, "build": by[v]["buildid"], "product": "iPhone17,1"} for v in versions]


class Plan(unittest.TestCase):
    def test_takes_every_missing_release_not_just_latest(self):
        got = plan(held("26.4"), P, [], None, None, 9)
        self.assertEqual([x["version"] for x in got], ["26.6.1", "26.6.2", "27.0"])

    def test_never_goes_below_the_oldest_held_image(self):
        self.assertNotIn("26.0", [x["version"] for x in plan(held("26.4"), P, [], None, None, 9)])

    def test_cap_keeps_the_oldest_missing_so_history_fills_in_order(self):
        self.assertEqual([x["version"] for x in plan(held("26.4"), P, [], None, None, 2)], ["26.6.1", "26.6.2"])

    def test_empty_bucket_takes_only_the_newest(self):
        self.assertEqual([x["version"] for x in plan([], P, [], None, None, 3)], ["27.0"])

    def test_nothing_to_do(self):
        self.assertEqual(plan(held(*[v["version"] for v in P]), P, [], None, None, 3), [])

    def test_explicit_version_ignores_held_and_floor(self):
        self.assertEqual(plan(held("26.4"), P, [], "26.0", None, 3), [{"version": "26.0", "build": "23A341", "device": "iPhone17,1"}])

    def test_falls_back_to_a_newer_device_only_for_releases_the_preferred_one_lacks(self):
        newer = [fw("28.0", "25A1", "iPhone19,7"), fw("27.0", "24A999", "iPhone19,7")]
        got = {x["version"]: x for x in plan(held("26.6.2"), P, newer, None, None, 9)}
        self.assertEqual(got["28.0"]["device"], "iPhone19,7")
        self.assertEqual((got["27.0"]["device"], got["27.0"]["build"]), ("iPhone17,1", "24A437"))

    def test_since_sets_the_floor_even_on_an_empty_bucket(self):
        self.assertEqual([x["version"] for x in plan([], P, [], None, "26.4", 9)], ["26.4", "26.6.1", "26.6.2", "27.0"])

    def test_a_reissued_build_of_a_held_version_is_picked_up(self):
        held = [{"version": "27.0", "build": "24A400", "product": "iPhone17,1"}, {"version": "26.4", "build": "23E246", "product": "iPhone17,1"}]
        got = plan(held, P, [], None, None, 9)
        self.assertIn(("27.0", "24A437"), [(x["version"], x["build"]) for x in got])
        self.assertNotIn("26.4", [x["version"] for x in got])

    def test_a_version_held_from_the_fallback_device_is_not_fetched_twice(self):
        held = [{"version": "28.0", "build": "25A1", "product": "iPhone19,7"}, {"version": "26.4", "build": "23E246", "product": "iPhone17,1"}]
        late = [fw("28.0", "25A9"), *P]
        self.assertNotIn("28.0", [x["version"] for x in plan(held, late, [], None, None, 9)])

    def test_orders_versions_numerically(self):
        got = plan([{"version": "9.3", "build": "z", "product": "iPhone17,1"}], [fw("10.0", "a"), fw("9.3.5", "b")], [], None, None, 9)
        self.assertEqual([x["version"] for x in got], ["9.3.5", "10.0"])


def beta(version, build, devices=("iPhone17,1",)):
    return {"version": version, "build": build, "beta": True,
            "devices": {d: {"ipsw": f"https://updates.cdn-apple.com/{d}_{build}.ipsw"} for d in devices}}


class Betas(unittest.TestCase):
    KEYS = ["iOS;24A5430a", "iOS;24A437", "iOS;24B5084k", "iOS;24B5089g", "iOS;24B5084k-sim",
            "iOS;24B5084k-27B5019j-SDK", "watchOS;24B5089g", "iOS;25A5001a"]

    def test_only_betas_past_the_newest_public_release(self):
        self.assertEqual(beta_candidates(self.KEYS, [], P), ["24B5084k", "24B5089g", "25A5001a"])

    def test_skips_betas_already_held(self):
        held = [{"version": "27.2 beta 1", "build": "24B5084k"}]
        self.assertEqual(beta_candidates(self.KEYS, held, P), ["24B5089g", "25A5001a"])

    def test_a_beta_whose_release_shipped_is_left_alone(self):
        self.assertEqual(beta_candidates(["iOS;24B5089g"], [], [fw("27.2", "24B80"), *P]), [])

    def test_plans_betas_oldest_first_with_apples_link(self):
        got = plan_betas([beta("27.2 beta 2", "24B5089g"), beta("27.2 beta 1", "24B5084k")], "iPhone17,1", 9)
        self.assertEqual([x["version"] for x in got], ["27.2 beta 1", "27.2 beta 2"])
        self.assertEqual(got[0], {"version": "27.2 beta 1", "build": "24B5084k", "device": "iPhone17,1",
                                  "url": "https://updates.cdn-apple.com/iPhone17,1_24B5084k.ipsw", "beta": True})

    def test_falls_back_to_the_newest_iphone_the_beta_has(self):
        got = plan_betas([beta("28.0 beta 1", "25A5001a", ("iPhone18,1", "iPhone19,2", "iPad16,1"))], "iPhone17,1", 9)
        self.assertEqual(got[0]["device"], "iPhone19,2")

    def test_ignores_records_that_are_not_betas(self):
        self.assertEqual(plan_betas([{**beta("27.2", "24B80"), "beta": False}], "iPhone17,1", 9), [])


class Baseband(unittest.TestCase):
    def test_lists_held_builds_without_baseband_newest_first_on_their_own_device(self):
        held = [{"version": "27.0", "build": "24A437", "product": "iPhone18,1"},
                {"version": "26.6.2", "build": "23G90", "product": "iPhone17,1"},
                {"version": "26.4", "build": "23E246", "product": "iPhone17,1"}]
        self.assertEqual(missing_baseband(held, {"24A437"}), [
            {"version": "26.6.2", "build": "23G90", "device": "iPhone17,1"},
            {"version": "26.4", "build": "23E246", "device": "iPhone17,1"}])

    def test_nothing_missing(self):
        self.assertEqual(missing_baseband([{"version": "27.0", "build": "24A437", "product": "iPhone18,1"}], {"24A437"}), [])


class Versions(unittest.TestCase):
    def test_beta_sorts_between_releases(self):
        v = ["27.2", "27.2 beta 10", "27.1", "27.2 beta 2", "27.2 RC", "27.2.1"]
        self.assertEqual(sorted(v, key=version_key), ["27.1", "27.2 beta 2", "27.2 beta 10", "27.2 RC", "27.2", "27.2.1"])

    def test_merge_is_newest_first_and_later_lists_win(self):
        now = [{"build": "24A437", "version": "27.0", "n": 1}, {"build": "24B5089g", "version": "27.2 beta 2"}]
        mine = [{"build": "24A437", "version": "27.0", "n": 2}]
        got = merge([now, mine])
        self.assertEqual([b["build"] for b in got], ["24B5089g", "24A437"])
        self.assertEqual(got[1]["n"], 2)


if __name__ == "__main__":
    unittest.main()
