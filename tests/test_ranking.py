import json
import unittest
from pathlib import Path

from app.ranking import (
    BUDGET_CONTROL_MAX_TOMAN,
    BUDGET_CONTROL_MIN_TOMAN,
    MAX_SCORE,
    rank_courses,
    validate_query,
    with_query_changes,
)


ROOT = Path(__file__).resolve().parents[1]


def load_json(relative_path: str):
    with (ROOT / relative_path).open(encoding="utf-8") as file:
        return json.load(file)


def find_course(result, course_id):
    for group_name, rows in result["groups"].items():
        for row in rows:
            if row["course_id"] == course_id:
                return group_name, row
    raise AssertionError(f"Course not found: {course_id}")


class RankingV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = load_json("data/courses.json")
        cls.query = load_json("data/sample-query.json")
        cls.sample_ranking = load_json("data/sample-ranking.json")
        cls.sample_scenarios = load_json("data/sample-scenarios.json")

    def test_budget_control_is_zero_to_thirty_million(self):
        validate_query(self.query)
        self.assertEqual(BUDGET_CONTROL_MIN_TOMAN, self.query["budget"]["control_min_toman"])
        self.assertEqual(BUDGET_CONTROL_MAX_TOMAN, self.query["budget"]["control_max_toman"])
        self.assertEqual(0, BUDGET_CONTROL_MIN_TOMAN)
        self.assertEqual(30_000_000, BUDGET_CONTROL_MAX_TOMAN)

    def test_invalid_budget_above_product_range_is_rejected(self):
        query = with_query_changes(
            self.query,
            {"budget": {"flexible_max_toman": 30_500_000}},
        )
        with self.assertRaises(ValueError):
            validate_query(query)

    def test_all_courses_remain_visible(self):
        result = rank_courses(self.dataset, self.query)
        self.assertEqual(8, result["summary"]["input_courses"])
        self.assertEqual(8, result["summary"]["visible_courses"])
        visible_ids = {
            row["course_id"]
            for rows in result["groups"].values()
            for row in rows
        }
        self.assertEqual({course["id"] for course in self.dataset["courses"]}, visible_ids)

    def test_baseline_groups_courses_without_deleting_them(self):
        result = rank_courses(self.dataset, self.query)
        self.assertEqual("current_matches", find_course(result, "neonlearn-ai-engineering")[0])
        self.assertEqual("flexible_matches", find_course(result, "tehrandata-llm")[0])
        self.assertEqual("stretch_options", find_course(result, "mftsk-llm-python")[0])
        self.assertEqual("stretch_options", find_course(result, "bardia-ai-engineering")[0])
        self.assertEqual("stretch_options", find_course(result, "udemyiran-advanced-rag")[0])
        self.assertEqual("stretch_options", find_course(result, "udemyiran-langgraph")[0])

    def test_increasing_flexible_budget_unlocks_mft_as_flexible(self):
        query = with_query_changes(
            self.query,
            {"budget": {"flexible_max_toman": 15_000_000}},
        )
        result = rank_courses(self.dataset, query)
        group, row = find_course(result, "mftsk-llm-python")
        self.assertEqual("flexible_matches", group)
        self.assertEqual("flexible", row["constraint_states"]["budget"])

    def test_rag_skill_unlocks_advanced_rag(self):
        query = with_query_changes(self.query, {"skills": {"rag": "beginner"}})
        result = rank_courses(self.dataset, query)
        group, row = find_course(result, "udemyiran-advanced-rag")
        self.assertEqual("current_matches", group)
        self.assertFalse(row["missing_skills"])

    def test_langchain_skill_unlocks_langgraph(self):
        query = with_query_changes(self.query, {"skills": {"langchain": "beginner"}})
        result = rank_courses(self.dataset, query)
        group, row = find_course(result, "udemyiran-langgraph")
        self.assertEqual("current_matches", group)
        self.assertFalse(row["missing_skills"])

    def test_longer_time_window_unlocks_bardia_as_flexible(self):
        query = with_query_changes(
            self.query,
            {
                "time": {
                    "flexible_deadline_weeks": 52,
                    "flexible_hours_per_week": 11,
                }
            },
        )
        result = rank_courses(self.dataset, query)
        group, row = find_course(result, "bardia-ai-engineering")
        self.assertEqual("flexible_matches", group)
        self.assertEqual("flexible", row["constraint_states"]["time"])

    def test_unknown_price_is_a_warning_and_course_remains_visible(self):
        result = rank_courses(self.dataset, self.query)
        _, row = find_course(result, "tehrandata-llm")
        self.assertTrue(any("قیمت عمومی نیست" in warning for warning in row["warnings"]))

    def test_result_is_deterministic_and_scores_are_bounded(self):
        first = rank_courses(self.dataset, self.query)
        second = rank_courses(self.dataset, self.query)
        self.assertEqual(first, second)
        for rows in first["groups"].values():
            self.assertTrue(all(0 <= row["score"] <= MAX_SCORE for row in rows))

    def test_dataset_has_eight_unique_traceable_records(self):
        courses = self.dataset["courses"]
        self.assertEqual(8, len(courses))
        self.assertEqual(8, len({course["id"] for course in courses}))
        for course in courses:
            self.assertTrue(course["source"]["url"].startswith("https://"))
            self.assertIn(course["rag"]["depth"], {"primary", "major_module"})
            self.assertIn("rag_relevant_hours", course["delivery"])
            self.assertIn("rag_module_independent", course["delivery"])
            self.assertIn("skill_requirements", course["audience"])

    def test_saved_ranking_summary_matches_executable_result(self):
        actual = rank_courses(self.dataset, self.query)
        self.assertEqual(actual["summary"], self.sample_ranking["summary"])
        for group_name, saved_rows in self.sample_ranking["groups"].items():
            self.assertEqual(
                [row["course_id"] for row in actual["groups"][group_name]],
                [row["course_id"] for row in saved_rows],
            )

    def test_saved_sensitivity_scenarios_match_executable_result(self):
        for scenario in self.sample_scenarios["scenarios"]:
            query = (
                with_query_changes(self.query, scenario["changes"])
                if scenario["changes"]
                else self.query
            )
            summary = rank_courses(self.dataset, query)["summary"]
            for key, expected in scenario["summary"].items():
                self.assertEqual(expected, summary[key], scenario["id"])


if __name__ == "__main__":
    unittest.main()
