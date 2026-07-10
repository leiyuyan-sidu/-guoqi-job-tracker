import base64
import json
import os

import requests

from config import PROFILE

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "anthropic/claude-haiku-4.5"


def _headers():
    return {
        "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
        "Content-Type": "application/json",
    }


def _chat(content, max_tokens):
    resp = requests.post(
        API_URL,
        headers=_headers(),
        json={
            "model": MODEL,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": max_tokens,
            "temperature": 0,
        },
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(f"OpenRouter API {resp.status_code}: {resp.text[:500]}")
    return resp.json()["choices"][0]["message"]["content"].strip()


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
    text = _chat(prompt, max_tokens=200)
    try:
        data = json.loads(text)
        return bool(data.get("eligible")), str(data.get("reason", "")).strip()
    except (json.JSONDecodeError, IndexError, KeyError):
        return False, "模型判断解析失败，默认不符合，需人工复核"


FREEFORM_PROMPT_TEMPLATE = """你在帮一名应届毕业生判断某国企/央企的招聘公告是否适合他报名。

应聘人情况：
- 学历：{degree}
- 专业：{major}（工商管理类下的专业学位硕士）
- 英语四级：{cet4}，英语六级：{cet6}

公告标题：{title}
公告正文（节选）：{contents}

请完成以下判断：
1. 这条公告是不是"应届毕业生校园招聘"性质？如果是社会招聘、要求多年工作经验的中层管理岗位、事业单位定向招考等非应届校招性质，is_campus 填 false。
2. 如果 is_campus 为 false，eligible 也填 false，reason 说明"非应届校招公告"。
3. 如果 is_campus 为 true，按以下规则判断专业是否符合：
   a. 专业要求覆盖"经济管理类/商科/文科类不限专业"等宽泛表述，或明确包含国际商务、国际贸易相关专业，即算符合
   b. 只要不是要求某个和商科完全无关的理工科/医科专业独占，就倾向认为符合
   c. 语言类要求（如英语四级/六级）应聘人已经满足
4. 从正文里提取：招聘单位名称（company）、学历要求概括（education，找不到填"详见公告"）、专业要求概括（major_requirement，找不到填"详见公告"）

请只输出一个 JSON 对象，不要输出其他任何文字，格式为：
{{"is_campus": true 或 false, "eligible": true 或 false, "reason": "一句话中文理由", "company": "招聘单位名称", "education": "学历要求概括", "major_requirement": "专业要求概括"}}
"""


def _image_content_block(image_url):
    resp = requests.get(image_url, timeout=20)
    resp.raise_for_status()
    media_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0]
    if not media_type.startswith("image/"):
        media_type = "image/jpeg"
    data = base64.b64encode(resp.content).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{data}"}}


def classify_freeform(title, contents, image_url=None):
    """判断一条国资委公告是否符合报名条件。

    有的公告正文是一整张招聘海报图片、没有文字（contents 为空或很短），
    这种情况下传 image_url，直接让大模型读图。
    """
    use_image = image_url and len(contents or "") < 30
    prompt = FREEFORM_PROMPT_TEMPLATE.format(
        degree=PROFILE["degree"],
        major=PROFILE["major"],
        cet4="已通过" if PROFILE["cet4_passed"] else "未通过",
        cet6="已通过" if PROFILE["cet6_passed"] else "未通过",
        title=title,
        contents=(contents or "")[:1500] or "（无文字正文，见后面的招聘海报图片）",
    )

    if use_image:
        content = [{"type": "text", "text": prompt}, _image_content_block(image_url)]
    else:
        content = prompt

    text = _chat(content, max_tokens=300)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = {}
    return {
        "is_campus": bool(data.get("is_campus")),
        "eligible": bool(data.get("eligible")),
        "reason": str(data.get("reason") or "模型判断解析失败，默认不符合，需人工复核"),
        "company": str(data.get("company") or "详见公告"),
        "education": str(data.get("education") or "详见公告"),
        "major_requirement": str(data.get("major_requirement") or "详见公告"),
    }
