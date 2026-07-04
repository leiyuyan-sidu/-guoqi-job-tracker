from config import (
    ELIGIBLE_MAJOR_KEYWORDS,
    DISLIKED_KEYWORDS,
    LOW_EDUCATION_LEVELS,
    EXCLUDED_TITLE_KEYWORDS,
)


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
