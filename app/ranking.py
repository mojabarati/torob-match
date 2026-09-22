"""Dynamic and explainable ranking for the Torob Match prototype."""

from __future__ import annotations

import argparse
import json
import math
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any


SCORING_VERSION = "2.0.0"
MAX_SCORE = 100.0
BUDGET_CONTROL_MIN_TOMAN = 0
BUDGET_CONTROL_MAX_TOMAN = 30_000_000

SCORE_WEIGHTS = {
    "topic_fit": 35.0,
    "practical_and_evaluation": 20.0,
    "skill_fit": 15.0,
    "time_fit": 10.0,
    "budget_fit": 10.0,
    "support_fit": 5.0,
    "data_confidence": 5.0,
}

PRIORITY_FACTORS = {
    "must": 1.0,
    "high": 0.85,
    "medium": 0.6,
    "low": 0.25,
    "none": 0.0,
}

SKILL_LEVELS = {
    "none": 0,
    "beginner": 1,
    "intermediate": 2,
    "advanced": 3,
}

GROUP_ORDER = (
    "current_matches",
    "flexible_matches",
    "stretch_options",
    "insufficient_data",
)


def _load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def _format_toman(value: int | float) -> str:
    return f"{value:,.0f} تومان"


def _round_up_half(value: float) -> float:
    return math.ceil(value * 2) / 2


def validate_query(query: dict[str, Any]) -> None:
    budget = query["budget"]
    if budget["control_min_toman"] != BUDGET_CONTROL_MIN_TOMAN:
        raise ValueError("حد پایین کنترل بودجه باید صفر تومان باشد.")
    if budget["control_max_toman"] != BUDGET_CONTROL_MAX_TOMAN:
        raise ValueError("حد بالای کنترل بودجه باید ۳۰ میلیون تومان باشد.")
    if not (
        BUDGET_CONTROL_MIN_TOMAN
        <= budget["preferred_max_toman"]
        <= budget["flexible_max_toman"]
        <= BUDGET_CONTROL_MAX_TOMAN
    ):
        raise ValueError("بودجه‌ی مطلوب و منعطف باید در بازه‌ی صفر تا ۳۰ میلیون مرتب باشند.")

    time = query["time"]
    if time["preferred_deadline_weeks"] > time["flexible_deadline_weeks"]:
        raise ValueError("مهلت منعطف نمی‌تواند کمتر از مهلت مطلوب باشد.")
    if time["preferred_hours_per_week"] > time["flexible_hours_per_week"]:
        raise ValueError("ساعت هفتگی منعطف نمی‌تواند کمتر از ساعت مطلوب باشد.")
    if any(value <= 0 for value in time.values()):
        raise ValueError("مقادیر زمانی باید بزرگ‌تر از صفر باشند.")

    for skill, level in query["skills"].items():
        if level not in SKILL_LEVELS:
            raise ValueError(f"سطح نامعتبر برای {skill}: {level}")


def _effective_hours(course: dict[str, Any]) -> tuple[float | None, str]:
    delivery = course["delivery"]
    if delivery["rag_module_independent"] is True and delivery["rag_relevant_hours"] is not None:
        return float(delivery["rag_relevant_hours"]), "rag_module"
    return delivery["total_hours"], "full_course"


def _evaluate_budget(course: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    budget = query["budget"]
    price = course["commercial"]["price_toman"]
    result = {"state": "unknown", "score": 4.0, "warnings": [], "adjustments": []}

    if price is None:
        result["warnings"].append("قیمت عمومی نیست و برای سنجش تناسب بودجه باید استعلام شود.")
        return result

    preferred = budget["preferred_max_toman"]
    flexible = budget["flexible_max_toman"]
    control_max = budget["control_max_toman"]

    if price <= preferred:
        result.update(state="preferred", score=SCORE_WEIGHTS["budget_fit"])
        return result

    if price <= flexible:
        span = max(1, flexible - preferred)
        ratio = (price - preferred) / span
        result.update(state="flexible", score=round(10.0 - (4.0 * ratio), 2))
        result["adjustments"].append(
            f"بودجه از مقدار مطلوب {_format_toman(preferred)} تا {_format_toman(price)} افزایش یابد."
        )
        return result

    if price <= control_max:
        remaining_span = max(1, control_max - flexible)
        ratio = (price - flexible) / remaining_span
        result.update(state="stretch", score=round(max(0.0, 4.0 * (1.0 - ratio)), 2))
        result["adjustments"].append(
            f"حد بودجه از {_format_toman(flexible)} به حداقل {_format_toman(price)} افزایش یابد."
        )
        return result

    result.update(state="stretch", score=0.0)
    result["adjustments"].append(
        f"قیمت {_format_toman(price)} حتی از سقف کنترل {_format_toman(control_max)} بیشتر است."
    )
    return result


def _evaluate_time(course: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    time = query["time"]
    hours, workload_scope = _effective_hours(course)
    duration_weeks = course["delivery"]["duration_weeks"]
    result = {
        "state": "unknown",
        "score": 5.0,
        "workload_hours": hours,
        "workload_scope": workload_scope,
        "warnings": [],
        "adjustments": [],
    }

    if hours is None:
        result["warnings"].append("مدت قابل استفاده برای این هدف منتشر نشده است.")
        return result

    preferred_weeks = float(time["preferred_deadline_weeks"])
    flexible_weeks = float(time["flexible_deadline_weeks"])
    preferred_hours = float(time["preferred_hours_per_week"])
    flexible_hours = float(time["flexible_hours_per_week"])
    preferred_capacity = preferred_weeks * preferred_hours
    flexible_capacity = flexible_weeks * flexible_hours

    preferred_ok = hours <= preferred_capacity and (
        duration_weeks is None or duration_weeks <= preferred_weeks
    )
    flexible_ok = hours <= flexible_capacity and (
        duration_weeks is None or duration_weeks <= flexible_weeks
    )

    if preferred_ok:
        result.update(state="preferred", score=SCORE_WEIGHTS["time_fit"])
        return result

    required_hours_at_preferred_deadline = _round_up_half(hours / preferred_weeks)
    required_weeks_at_preferred_hours = math.ceil(hours / preferred_hours)
    if duration_weeks is not None:
        required_weeks_at_preferred_hours = max(required_weeks_at_preferred_hours, math.ceil(duration_weeks))

    if flexible_ok:
        result.update(state="flexible", score=6.0)
        if required_hours_at_preferred_deadline <= flexible_hours and (
            duration_weeks is None or duration_weeks <= preferred_weeks
        ):
            result["adjustments"].append(
                f"زمان هفتگی از {preferred_hours:g} به حدود {required_hours_at_preferred_deadline:g} ساعت افزایش یابد."
            )
        else:
            result["adjustments"].append(
                f"مهلت از {preferred_weeks:g} به حدود {required_weeks_at_preferred_hours:g} هفته افزایش یابد."
            )
        return result

    result.update(state="stretch", score=0.0)
    result["adjustments"].extend(
        [
            f"برای پایان در {preferred_weeks:g} هفته، حدود {required_hours_at_preferred_deadline:g} ساعت در هفته لازم است.",
            f"با {preferred_hours:g} ساعت در هفته، حدود {required_weeks_at_preferred_hours:g} هفته لازم است.",
        ]
    )
    return result


def _evaluate_skills(course: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    requirements = course["audience"]["skill_requirements"]
    if not requirements:
        return {
            "state": "preferred",
            "score": SCORE_WEIGHTS["skill_fit"],
            "missing": [],
            "adjustments": [],
        }

    missing: list[dict[str, str]] = []
    met = 0
    for requirement in requirements:
        current_level = query["skills"].get(requirement["skill"], "none")
        if SKILL_LEVELS[current_level] >= SKILL_LEVELS[requirement["minimum_level"]]:
            met += 1
        else:
            missing.append(
                {
                    "skill": requirement["skill"],
                    "current_level": current_level,
                    "required_level": requirement["minimum_level"],
                }
            )

    score = SCORE_WEIGHTS["skill_fit"] * (met / len(requirements))
    return {
        "state": "preferred" if not missing else "stretch",
        "score": round(score, 2),
        "missing": missing,
        "adjustments": [
            f"سطح {item['skill']} از {item['current_level']} به حداقل {item['required_level']} برسد."
            for item in missing
        ],
    }


def _evaluate_topics(course: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    required = query["priorities"]["required_topics"]
    topic_data = course["rag"]["topics"]
    total_weight = sum(PRIORITY_FACTORS[value] for value in required.values()) or 1.0
    covered_weight = 0.0
    matched: list[str] = []
    unverified: list[str] = []
    missing: list[str] = []

    for topic, priority in required.items():
        state = topic_data.get(topic)
        if state is True:
            matched.append(topic)
            covered_weight += PRIORITY_FACTORS[priority]
        elif state is False:
            missing.append(topic)
        else:
            unverified.append(topic)

    return {
        "score": round(SCORE_WEIGHTS["topic_fit"] * covered_weight / total_weight, 2),
        "matched": matched,
        "unverified": unverified,
        "missing": missing,
    }


def _evaluate_practical(course: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    project_priority = PRIORITY_FACTORS[query["priorities"]["hands_on_project"]]
    evaluation_priority = PRIORITY_FACTORS[
        query["priorities"]["required_topics"].get("evaluation", "none")
    ]
    project_state = course["learning_experience"]["hands_on_project"]
    evaluation_state = course["rag"]["topics"]["evaluation"]
    score = 0.0
    warnings: list[str] = []

    if project_state is True:
        score += 12.0 * project_priority
    elif project_state is None and project_priority:
        warnings.append("وجود پروژه‌ی عملی در اطلاعات عمومی مشخص نیست.")

    if evaluation_state is True:
        score += 8.0 * evaluation_priority
    elif evaluation_state is None and evaluation_priority:
        warnings.append("پوشش عملی evaluation در اطلاعات عمومی قابل اثبات نیست.")

    return {"score": round(score, 2), "warnings": warnings}


def _evaluate_support(course: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    factor = PRIORITY_FACTORS[query["priorities"]["mentor_support"]]
    state = course["learning_experience"]["mentor_support"]
    warnings: list[str] = []
    score = SCORE_WEIGHTS["support_fit"] * factor if state is True else 0.0
    if state is None and factor:
        warnings.append("دسترسی به منتور یا پشتیبان مشخص نیست.")
    return {"score": round(score, 2), "warnings": warnings}


def _result_group(states: dict[str, str]) -> str:
    if states["persian_access"] == "stretch" or "stretch" in {
        states["budget"],
        states["time"],
        states["skills"],
    }:
        return "stretch_options"
    if "unknown" in {states["budget"], states["time"]}:
        return "flexible_matches"
    if "flexible" in {states["budget"], states["time"]}:
        return "flexible_matches"
    return "current_matches"


def _rank_one(course: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    budget = _evaluate_budget(course, query)
    time = _evaluate_time(course, query)
    skills = _evaluate_skills(course, query)
    topics = _evaluate_topics(course, query)
    practical = _evaluate_practical(course, query)
    support = _evaluate_support(course, query)
    persian_state = (
        "preferred"
        if not query["persian_access_required"]
        or course["localization"]["persian_access"] in {"native", "subtitled"}
        else "stretch"
    )

    confidence_score = round(
        SCORE_WEIGHTS["data_confidence"] * float(course["data_quality"]["completeness"]),
        2,
    )
    components = {
        "topic_fit": topics["score"],
        "practical_and_evaluation": practical["score"],
        "skill_fit": skills["score"],
        "time_fit": time["score"],
        "budget_fit": budget["score"],
        "support_fit": support["score"],
        "data_confidence": confidence_score,
    }
    score = round(min(MAX_SCORE, sum(components.values())), 2)
    states = {
        "budget": budget["state"],
        "time": time["state"],
        "skills": skills["state"],
        "persian_access": persian_state,
    }
    group = _result_group(states)
    warnings = budget["warnings"] + time["warnings"] + practical["warnings"] + support["warnings"]
    if topics["unverified"]:
        warnings.append(
            "پوشش این موضوع‌های ضروری در اطلاعات عمومی قابل اثبات نیست: "
            + "، ".join(topics["unverified"])
        )
    gaps = []
    if topics["missing"]:
        gaps.append("موضوع‌های ضروری فاقد پوشش: " + "، ".join(topics["missing"]))
    if persian_state == "stretch":
        gaps.append("دسترسی فارسی ندارد.")

    adjustments = budget["adjustments"] + time["adjustments"] + skills["adjustments"]
    exact_match = (
        group == "current_matches"
        and not topics["unverified"]
        and not topics["missing"]
        and not warnings
        and not gaps
    )

    return {
        "course_id": course["id"],
        "title_fa": course["title_fa"],
        "provider": course["provider"],
        "source_url": course["source"]["url"],
        "group": group,
        "score": score,
        "score_components": components,
        "constraint_states": states,
        "workload": {
            "hours": time["workload_hours"],
            "scope": time["workload_scope"],
        },
        "matched_required_topics": topics["matched"],
        "unverified_required_topics": topics["unverified"],
        "missing_required_topics": topics["missing"],
        "missing_skills": skills["missing"],
        "adjustments": adjustments,
        "warnings": warnings,
        "gaps": gaps,
        "exact_match": exact_match,
    }


def rank_courses(dataset: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    """Rank every course and retain options that need user flexibility."""
    validate_query(query)
    groups: dict[str, list[dict[str, Any]]] = {name: [] for name in GROUP_ORDER}

    for course in dataset["courses"]:
        result = _rank_one(course, query)
        groups[result["group"]].append(result)

    for rows in groups.values():
        rows.sort(key=lambda item: (-item["score"], item["course_id"]))

    return {
        "product_name": dataset["dataset"]["product_name"],
        "query_id": query["id"],
        "scoring_version": SCORING_VERSION,
        "score_weights": SCORE_WEIGHTS,
        "budget_control": {
            "min_toman": BUDGET_CONTROL_MIN_TOMAN,
            "max_toman": BUDGET_CONTROL_MAX_TOMAN,
            "preferred_max_toman": query["budget"]["preferred_max_toman"],
            "flexible_max_toman": query["budget"]["flexible_max_toman"],
        },
        "summary": {
            "input_courses": len(dataset["courses"]),
            "visible_courses": sum(len(rows) for rows in groups.values()),
            "current_matches": len(groups["current_matches"]),
            "flexible_matches": len(groups["flexible_matches"]),
            "stretch_options": len(groups["stretch_options"]),
            "insufficient_data": len(groups["insufficient_data"]),
            "exact_matches": sum(
                1 for rows in groups.values() for item in rows if item["exact_match"]
            ),
        },
        "groups": groups,
    }


def with_query_changes(query: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    """Return a query copy with shallow changes for budget, time, or skills."""
    updated = deepcopy(query)
    for section, values in changes.items():
        if not isinstance(values, dict) or section not in updated:
            raise ValueError(f"بخش تغییر نامعتبر است: {section}")
        updated[section].update(values)
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Rank Torob Match course records")
    parser.add_argument("--courses", type=Path, required=True)
    parser.add_argument("--query", type=Path, required=True)
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    result = rank_courses(_load_json(args.courses), _load_json(args.query))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
