import json
import unittest
from copy import deepcopy
from pathlib import Path

from app.ranking import MAX_SCORE, rank_courses


ROOT = Path(__file__).resolve().parents[1]


def load_json(relative_path: str):
    with (ROOT / relative_path).open(encoding="utf-8") as file:
        return json.load(file)


class RankingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = load_json("data/courses.json")
        cls.query = load_json("data/sample-query.json")

    def test_result_is_deterministic_and_bounded(self):
        first = rank_courses(self.dataset, self.query)
        second = rank_courses(self.dataset, self.query)
        self.assertEqual(first, second)
        self.assertTrue(all(0 <= row["score"] <= MAX_SCORE for row in first["ranked_courses"]))

    def test_dataset_has_eight_unique_traceable_records(self):
        courses = self.dataset["courses"]
        self.assertEqual(8, len(courses))
        self.assertEqual(8, len({course["id"] for course in courses}))
        for course in courses:
            self.assertTrue(course["source"]["url"].startswith("https://"))
            self.assertEqual("2026-09-18", course["source"]["observed_at"])
            self.assertIn(course["rag"]["depth"], {"primary", "major_module"})

    def test_saved_sample_matches_current_ranking(self):
        result = rank_courses(self.dataset, self.query)
        saved = load_json("data/sample-ranking.json")
        self.assertEqual(saved["summary"]["input_courses"], result["summary"]["input_courses"])
        self.assertEqual(saved["summary"]["eligible_courses"], result["summary"]["eligible_courses"])
        self.assertEqual(saved["summary"]["excluded_courses"], result["summary"]["excluded_courses"])
        self.assertEqual(saved["summary"]["exact_match"], result["summary"]["exact_match"])
        self.assertEqual(
            [(row["course_id"], row["score"]) for row in saved["ranked_courses"]],
            [(row["course_id"], row["score"]) for row in result["ranked_courses"]],
        )
        self.assertEqual(
            set(saved["excluded_course_ids"]),
            {row["course_id"] for row in result["excluded_courses"]},
        )

    def test_budget_violation_is_a_hard_exclusion(self):
        result = rank_courses(self.dataset, self.query)
        mft = next(row for row in result["excluded_courses"] if row["course_id"] == "mftsk-llm-python")
        self.assertTrue(any("سقف" in reason for reason in mft["exclusion_reasons"]))

    def test_missing_public_price_warns_instead_of_excluding_by_itself(self):
        dataset = deepcopy(self.dataset)
        course = next(row for row in dataset["courses"] if row["id"] == "tehrandata-llm")
        course["delivery"]["total_hours"] = 60
        course["delivery"]["duration_weeks"] = 10

        result = rank_courses(dataset, self.query)
        ranked = next(row for row in result["ranked_courses"] if row["course_id"] == "tehrandata-llm")
        self.assertTrue(any("قیمت عمومی نیست" in warning for warning in ranked["warnings"]))

    def test_unmet_advanced_prerequisite_excludes_course(self):
        result = rank_courses(self.dataset, self.query)
        advanced = next(
            row for row in result["excluded_courses"] if row["course_id"] == "udemyiran-advanced-rag"
        )
        self.assertTrue(any("rag_basic" in reason for reason in advanced["exclusion_reasons"]))

    def test_unknown_topic_is_not_reported_as_confirmed_absence(self):
        result = rank_courses(self.dataset, self.query)
        prompt_rag = next(
            row for row in result["ranked_courses"] if row["course_id"] == "udemyiran-prompt-rag"
        )
        self.assertFalse(any("صریحاً پوشش داده نمی‌شوند" in gap for gap in prompt_rag["gaps"]))
        self.assertTrue(any("قابل اثبات نیست" in warning for warning in prompt_rag["warnings"]))


if __name__ == "__main__":
    unittest.main()
