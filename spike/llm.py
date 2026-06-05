# -*- coding: utf-8 -*-
"""调用硅基流动（SiliconFlow）的最薄封装——只用 Python 标准库，零依赖。

硅基流动是 OpenAI 兼容接口：往 /chat/completions POST 一段 JSON，
带上 Authorization: Bearer <你的key> 就行。openai 这个第三方包只是同一件事的
方便封装，这里特意用标准库 urllib，让你看清"一次 LLM 调用"到底是怎么回事。

用法：先设环境变量 SILICONFLOW_API_KEY=你的key，再 import chat。
"""

import json
import os
import time
import urllib.error
import urllib.request

ENDPOINT = "https://api.siliconflow.cn/v1/chat/completions"


def _api_key():
    key = os.environ.get("SILICONFLOW_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise SystemExit(
            "未找到 API key。请先设置环境变量：\n"
            '  PowerShell:  $env:SILICONFLOW_API_KEY = "你的硅基流动key"'
        )
    return key


def chat(model, system, user, temperature=0.8, timeout=90):
    """发一次对话请求，返回 (回复文本, 耗时秒数)。"""
    payload = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
        },
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")
        raise RuntimeError(f"HTTP {e.code} 调用失败：{detail}") from e
    dt = time.time() - t0

    text = data["choices"][0]["message"]["content"].strip()
    return text, dt
