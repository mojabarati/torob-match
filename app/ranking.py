"""Deterministic, explainable ranking for the DorehYab prototype."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


MAX_SCORE = 100.0

SCORE_WEIGHTS = {
    "topic_fit": 40.0,
    "practical_fit": 15.0,
    "level_fit": 15.0,
    "time_fit": 10.0,
    "budget_fit": 10.0,
    "support_fit": 5.0,
    "data_confidence": 5.0,
}

LEVEL_FIT = {
    "beginner": {
        "beginner": 1.0,
        "intermediate": 0.65,
        "advanced": 0.25,
        "mixed": 0.9,
    },
    "intermediate": {
        "beginner": 0.5,
        "intermediate": 1.0,
        "advanced": 0.7,
        "mixed": 0.85,
    },
    "advanced": {
        "beginner": 0.2,
        "intermediate": 0.65,
        "advanced": 1.0,
        "mixed": 0.8,
    },
}

SKILL_IMPLICATIONS = {
    "python_advanced": {"python_advanced", "python_intermediate", "python_basic"},
    "python_intermediate": {"python_intermediate", "python_basic"},
    "python_basic": {"python_basic"},
}


def _load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def _expanded_skills(skill_tags: list[str]) -> set[str]:
    expanded: set[str] = set()
    for skill in skill_tags:
        expanded.update(SKILL_IMPLICATIONS.get(skill, {skill}))
    return expanded


def _topic_state(course: dict[str, Any], topic: str) -> bool | None:
    return course["rag"]["topics"].get(topic)


def _hard_filter(course: dict[str, Any], query: dict[str, Any]) -> tuple[list[str], list[str]]:
    exclusions: list[str] = []
    warnings: list[str] = []
    hard_constraints = set(query.get("hard_constraints", []))

    if "persian_access" in hard_constraints and query.get("persian_access_required"):
        access = course["localization"]["persian_access"]
        if access == "unknown":
            warnings.append("نوع دسترسی فارسی مشخص نیست.")
        elif access not in {"native", "subtitled"}:
            exclusions.append("دسترسی فارسی ندارد.")

    if "budget" in hard_constraints:
        max_price = query.get("budget_max_toman")
        price = course["commercial"]["price_toman"]
        if max_price is not None:
            if price is None:
                warnings.append("قیمت عمومی نیست و پیش از انتخاب باید استعلام شود.")
            elif price > max_price:
                exclusions.append(
                    f"قیمت مشاهده‌شده {price:,} تومان از سقف {max_price:,} تومان بیشتر است."
                )

    if "time" in hard_constraints:
        hour_budget = query.get("time_budget_total_hours")
        total_hours = course["delivery"]["total_hours"]
        if hour_budget is not None:
            if total_hours is None:
                warnings.append("مدت کل دوره منتشر نشده است.")
            elif total_hours > hour_budget:
                exclusions.append(
                    f"مدت {total_hours:g} ساعته از بودجه‌ی زمانی {hour_budget:g} ساعت بیشتر است."
                )

        max_weeks = query.get("max_duration_weeks")
        duration_weeks = course["delivery"]["duration_weeks"]
        if max_weeks is not None and duration_weeks is not None and duration_weeks > max_weeks:
            exclusions.append(
                f"طول {duration_weeks:g} هفته‌ای از مهلت {max_weeks:g} هفته بیشتر است."
            )

    if "prerequisites" in hard_constraints:
        user_skills = _expanded_skills(query.get("current_skill_tags", []))
        missing = [
            tag
            for tag in course["audience"]["prerequisite_tags"]
            if tag not in user_skills
        ]
        if missing:
            exclusions.append("پیش‌نیازهای احرازنشده: " + "، ".join(missing))

    return exclusions, warnings


def _score_eligible(course: dict[str, Any], query: dict[str, Any]) -> tuple[dict[str, float], list[str], list[str]]:
    warnings: list[str] = []
    gaps: list[str] = []

    required_topics = query.get("required_topics", [])
    covered_topics = [topic for topic in required_topics if _topic_state(course, topic) is True]
    unknown_topics = [topic for topic in required_topics if _topic_state(course, topic) is None]
    missing_topics = [topic for topic in required_topics if _topic_state(course, topic) is False]

    if unknown_topics:
        warnings.append("پوشش عمومی این موضوع‌ها قابل اثبات نیست: " + "، ".join(unknown_topics))
    if missing_topics:
        gaps.append("این موضوع‌ها صریحاً پوشش داده نمی‌شوند: " + "، ".join(missing_topics))

    topic_ratio = len(covered_topics) / len(required_topics) if required_topics else 1.0
    topic_fit = SCORE_WEIGHTS["topic_fit"] * topic_ratio

    practical_preference = float(query.get("preferences", {}).get("hands_on_project", 0.0))
    project_state = course["learning_experience"]["hands_on_project"]
    practical_fit = (
        SCORE_WEIGHTS["practical_fit"] * practical_preference if project_state is True else 0.0
    )
    if project_state is None and practical_preference:
        warnings.append("وجود پروژه‌ی عملی در منبع عمومی مشخص نیست.")
    elif project_state is False and practical_preference:
        gaps.append("پروژه‌ی عملی ندارد.")

    target_level = query.get("target_level", "intermediate")
    course_level = course["audience"]["level"]
    level_ratio = LEVEL_FIT.get(target_level, LEVEL_FIT["intermediate"]).get(course_level, 0.5)
    level_fit = SCORE_WEIGHTS["level_fit"] * level_ratio

    total_hours = course["delivery"]["total_hours"]
    time_fit = SCORE_WEIGHTS["time_fit"] if total_hours is not None else SCORE_WEIGHTS["time_fit"] * 0.5

    max_price = query.get("budget_max_toman")
    price = course["commercial"]["price_toman"]
    if max_price and price is not None:
        budget_ratio = max(0.0, 1.0 - (price / max_price))
        budget_fit = SCORE_WEIGHTS["budget_fit"] * budget_ratio
    elif price == 0:
        budget_fit = SCORE_WEIGHTS["budget_fit"]
    else:
        budget_fit = SCORE_WEIGHTS["budget_fit"] * 0.4

    support_preference = float(query.get("preferences", {}).get("mentor_support", 0.0))
    mentor_state = course["learning_experience"]["mentor_support"]
    support_fit = (
        SCORE_WEIGHTS["support_fit"] * support_preference if mentor_state is True else 0.0
    )
    if mentor_state is None and support_preference:
        warnings.append("دسترسی به منتور یا پشتیبان مشخص نیست.")
    elif mentor_state is False and support_preference:
        gaps.append("منتور یا پشتیبانی آموزشی ساختاریافته ندارد.")

    data_confidence = SCORE_WEIGHTS["data_confidence"] * float(
        course["data_quality"]["completeness"]
    )

    components = {
        "topic_fit": round(topic_fit, 2),
        "practical_fit": round(practical_fit, 2),
        "level_fit": round(level_fit, 2),
        "time_fit": round(time_fit, 2),
        "budget_fit": round(budget_fit, 2),
        "support_fit": round(support_fit, 2),
        "data_confidence": round(data_confidence, 2),
    }
    return components, warnings, gaps


def rank_courses(dataset: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    """Rank courses while keeping exclusions and uncertainty explicit."""
    eligible: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []

    for course in dataset["courses"]:
        exclusions, hard_warnings = _hard_filter(course, query)
        base = {
            "course_id": course["id"],
            "title_fa": course["title_fa"],
            "provider": course["provider"],
            "source_url": course["source"]["url"],
        }

        if exclusions:
            excluded.append({**base, "exclusion_reasons": exclusions, "warnings": hard_warnings})
            continue

        components, score_warnings, gaps = _score_eligible(course, query)
        score = round(min(MAX_SCORE, sum(components.values())), 2)
        eligible.append(
            {
                **base,
                "score": score,
                "score_components": components,
                "matched_required_topics": [
                    topic
                    for topic in query.get("required_topics", [])
                    if _topic_state(course, topic) is True
                ],
                "warnings": hard_warnings + score_warnings,
                "gaps": gaps,
            }
        )

    eligible.sort(key=lambda item: (-item["score"], item["course_id"]))
    excluded.sort(key=lambda item: item["course_id"])

    return {
        "product_name": dataset["dataset"]["product_name"],
        "query_id": query["id"],
        "scoring_version": "1.0.0",
        "score_weights": SCORE_WEIGHTS,
        "summary": {
            "input_courses": len(dataset["courses"]),
            "eligible_courses": len(eligible),
            "excluded_courses": len(excluded),
            "exact_match": any(not item["warnings"] and not item["gaps"] for item in eligible),
        },
        "ranked_courses": eligible,
        "excluded_courses": excluded,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Rank DorehYab course records")
    parser.add_argument("--courses", type=Path, required=True)
    parser.add_argument("--query", type=Path, required=True)
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    result = rank_courses(_load_json(args.courses), _load_json(args.query))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
