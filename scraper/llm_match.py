import json
import os

import requests

from config import PROFILE

API_URL = "https://api.deepseek.com/chat/completions"

PROMPT_TEMPLATE = """你在帮一名应届毕业生判断能否报名某个国企/央企校园招聘岗位。

应聘人情况：
- 学历：{degree}
- 专业：{major}（工商管理类下的专业学位硕士）
- 英语四级：{cet4}，英语六级：{cet6}

岗位专业要求原文：{major_cn}
岗位描述：{contents}

请判断这名应聘人能否报名该岗位。规则：
1. 只要专业要求覆盖"经济管理类/商科/文科类不限专业"等宽泛表述，或明确包含国际商务、国际贸易相关专业，即算符合。
2. 只要不是要求某个和商科完全无关的理工科/医科专业独占（比如只招计算机、临床医学、机械等且没有放宽），就倾向认为符合。
3. 语言类要求（如英语四级/六级）应聘人已经满足。

请只输出一个 JSON 对象，不要输出其他任何文字，格式为：
{{"eligible": true 或 false, "reason": "一句话中文理由"}}
"""


def classify(major_cn_list, contents):
    prompt = PROMPT_TEMPLATE.format(
        degree=PROFILE["degree"],
        major=PROFILE["major"],
        cet4="已通过" if PROFILE["cet4_passed"] else "未通过",
        cet6="已通过" if PROFILE["cet6_passed"] else "未通过",
        major_cn="、".join(major_cn_list or []) or "（未注明）",
        contents=(contents or "")[:800],
    )
    resp = requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {os.environ['DEEPSEEK_API_KEY']}",
            "Content-Type": "application/json",
        },
        json={
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 200,
            "temperature": 0,
            "response_format": {"type": "json_object"},
        },
        timeout=30,
    )
    resp.raise_for_status()
    text = resp.json()["choices"][0]["message"]["content"].strip()
    try:
        data = json.loads(text)
        return bool(data.get("eligible")), str(data.get("reason", "")).strip()
    except (json.JSONDecodeError, KeyError):
        return False, "模型判断解析失败，默认不符合，需人工复核"
