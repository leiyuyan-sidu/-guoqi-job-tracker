import re

from config import (
    ELIGIBLE_MAJOR_KEYWORDS,
    DISLIKED_KEYWORDS,
    LOW_EDUCATION_LEVELS,
    EXCLUDED_TITLE_KEYWORDS,
)


_COHORT_PATTERNS = [
    re.compile(r"(?<!\d)(20\d{2}|\d{2})\s*届"),
    re.compile(r"(?<!\d)(20\d{2})\s*年(?:度)?\s*(?:应届)?毕业生"),
    re.compile(r"(?:毕业时间|毕业年份|毕业日期)[^。；;\n]{0,20}?(20\d{2})\s*年"),
    re.compile(r"(?<!\d)(20\d{2})\s*年[^。；;\n]{0,8}?毕业"),
]


def check_graduation_year(target_year, *texts):
    """检查公告明确限定的毕业届别。

    返回 (True, reason) 表示目标届别可报名，(False, reason) 表示公告明确排除目标届别，
    (None, None) 表示正文没有足够明确的届别限制。只识别“届/毕业生/毕业时间”等语境，
    避免把“2026年度招聘”误判成仅招2026届。
    """
    text = " ".join(str(value) for value in texts if value)
    if not text:
        return None, None

    years = set()
    for pattern in _COHORT_PATTERNS:
        for raw_year in pattern.findall(text):
            year = int(raw_year)
            years.add(2000 + year if year < 100 else year)

    if target_year in years:
        return True, f"公告包含{target_year}届/年毕业生"

    for start_raw, end_raw in re.findall(
        r"(?<!\d)(20\d{2}|\d{2})\s*(?:至|到|—|-|~|～)\s*(20\d{2}|\d{2})\s*届", text
    ):
        start_year, end_year = int(start_raw), int(end_raw)
        start_year = 2000 + start_year if start_year < 100 else start_year
        end_year = 2000 + end_year if end_year < 100 else end_year
        if start_year <= target_year <= end_year:
            return True, f"公告面向{start_year}至{end_year}届，包含{target_year}届"

    # “2026届及以后（之后）”包含2027届；“2026届及以前”则不包含。
    for raw_year in re.findall(r"(?<!\d)(20\d{2}|\d{2})\s*届\s*(?:及|或)?(?:以后|之后)", text):
        start_year = int(raw_year)
        start_year = 2000 + start_year if start_year < 100 else start_year
        if target_year >= start_year:
            return True, f"公告面向{start_year}届及以后毕业生，包含{target_year}届"

    for raw_year in re.findall(r"(?<!\d)(20\d{2}|\d{2})\s*届\s*(?:及|或)?(?:以前|之前)", text):
        end_year = int(raw_year)
        end_year = 2000 + end_year if end_year < 100 else end_year
        if target_year <= end_year:
            return True, f"公告面向{end_year}届及以前毕业生，包含{target_year}届"

    if years:
        listed = "、".join(str(year) for year in sorted(years))
        return False, f"公告仅明确面向{listed}届/年毕业生，不包含{target_year}届"
    return None, None


def is_blue_collar(title, education):
    """学历要求过低或岗位名称命中蓝领/技能岗关键词，直接判定不符合，不用再看专业要求。"""
    if education and education.strip() in LOW_EDUCATION_LEVELS:
        return True
    title = title or ""
    return any(kw in title for kw in EXCLUDED_TITLE_KEYWORDS)


def rule_based_eligible(major_cn_list, contents):
    """只根据结构化的专业要求字段（major_cn）做规则判断，命中返回 (True, reason)。

    不搜索 contents 正文——正文里常有"优先考虑：数学/计算机/市场营销等专业"这类加分项
    描述，如果拿关键词去搜正文会把非硬性要求也误判为符合，所以正文一律交给大模型判断。
    规则判不出来时返回 (None, None)。
    """
    text = " ".join(major_cn_list or [])
    for kw in ELIGIBLE_MAJOR_KEYWORDS:
        if kw in text:
            return True, f"专业要求命中关键词「{kw}」"
    return None, None


def check_disliked(*texts):
    """命中不喜欢的关键词（证券/会计）则返回该关键词，否则返回 None。"""
    text = " ".join(t for t in texts if t)
    for kw in DISLIKED_KEYWORDS:
        if kw in text:
            return kw
    return None
