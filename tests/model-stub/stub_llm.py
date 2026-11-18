#!/usr/bin/env python3
"""脚本化的 OpenAI 兼容模型桩（仅用于机制测试，不是真实大模型）。

用途：在没有真实模型凭证的环境里，驱动**真实的 Hermes Gateway / Webapp / 工具执行链路**，
用确定性的回复验证会话同步、断线恢复、取消、文件和防重复执行。它只替代“模型供应商”这一环，
Hermes 本身、它的工具、会话存储和事件流都是真实运行的。测试报告中凡使用此桩的结果都标注为
“真实 Hermes + 模拟模型”。

指令（写在用户消息里）：
  [slow N]           以约 N 秒的时长分段流式输出（用于断线/取消测试）
  [write PATH] TEXT  让 Hermes 调用 write_file 把 TEXT 写到 PATH
  [read PATH]        让 Hermes 调用 read_file 读取 PATH
  [sh COMMAND]       让 Hermes 调用 terminal 执行 COMMAND（会走 Hermes 自己的批准规则）
  [recall]           回复本会话里之前所有用户消息（验证上下文连续）
  [readattached]     让 Hermes 用 read_file 读取消息里 @file: 指向的附件（验证附件真实可访问）
  [markdown]         输出长正文、超长代码行、宽表格和长链接（验证移动端渲染）
  [xss]              输出带脚本/事件属性/javascript: 链接的内容（验证安全渲染）
其他文本：回复“收到：<文本>（本会话第 N 条用户消息）”。

每次请求都追加记录到 --log 指定的 JSONL 文件，测试据此确认“同一条消息只被执行一次”。
"""
from __future__ import annotations

import argparse
import json
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG_LOCK = threading.Lock()
ARGS = None

MARKDOWN_SAMPLE = (
    "## 长内容渲染测试\n\n"
    "一段很长的中文正文，用来检查换行是否正常。" * 6 + "\n\n"
    "```python\n"
    "def very_long_function_name_for_overflow_check(argument_one, argument_two, argument_three, argument_four, argument_five):\n"
    "    return argument_one + argument_two + argument_three + argument_four + argument_five  # 这一行非常长，必须在代码块内部横向滚动\n"
    "```\n\n"
    "| 列一 | 列二 | 列三 | 列四 | 列五 | 列六 | 列七 | 列八 |\n"
    "|---|---|---|---|---|---|---|---|\n"
    "| 很长很长的单元格内容A | 很长很长的单元格内容B | 很长很长的单元格内容C | 很长很长的单元格内容D "
    "| 很长很长的单元格内容E | 很长很长的单元格内容F | 很长很长的单元格内容G | 很长很长的单元格内容H |\n\n"
    "链接：https://example.com/a/very/long/path/that/should/wrap/or/scroll/without/breaking/the/page/layout/0123456789\n"
)

XSS_SAMPLE = (
    "渲染安全测试：\n\n"
    "<img src=x onerror=\"window.__xss_img=1\">\n\n"
    "<script>window.__xss_script=1</script>\n\n"
    "[点我](javascript:window.__xss_link=1)\n\n"
    "<iframe src=\"javascript:window.top.__xss_iframe=1\"></iframe>\n"
)


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for part in content:
            if isinstance(part, dict) and part.get("type") in ("text", "input_text"):
                out.append(part.get("text", ""))
        return "\n".join(out)
    return ""


def _log(entry: dict) -> None:
    if not ARGS.log:
        return
    with LOG_LOCK, open(ARGS.log, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def plan(messages: list) -> dict:
    """Decide the reply: {'text': str, 'slow': float} or {'tool': name, 'args': {...}}."""
    users = [_text(m.get("content")) for m in messages if m.get("role") == "user"]
    last = messages[-1] if messages else {}
    if last.get("role") == "tool":
        body = _text(last.get("content"))[:400]
        return {"text": f"工具已执行，结果摘要：{body}"}
    text = users[-1] if users else ""
    m = re.search(r"\[slow\s+(\d+(?:\.\d+)?)\]", text)
    if m:
        return {"text": f"慢速任务开始。{text}", "slow": float(m.group(1))}
    m = re.search(r"\[write\s+(\S+)\]\s*(.*)", text, re.S)
    if m:
        return {"tool": "write_file", "args": {"path": m.group(1), "content": m.group(2).strip() + "\n"}}
    m = re.search(r"\[read\s+(\S+)\]", text)
    if m:
        return {"tool": "read_file", "args": {"path": m.group(1)}}
    m = re.search(r"\[sh\s+(.+?)\]\s*$", text, re.S)
    if m:
        return {"tool": "terminal", "args": {"command": m.group(1).strip(), "timeout": 60}}
    if "[readattached]" in text:
        m = re.search(r"@file:(\S+)", text)
        if m:
            return {"tool": "read_file", "args": {"path": m.group(1)}}
        return {"text": "没有找到附件路径"}
    if "[markdown]" in text:
        return {"text": MARKDOWN_SAMPLE}
    if "[xss]" in text:
        return {"text": XSS_SAMPLE}
    if "[recall]" in text:
        prev = [u for u in users[:-1]]
        return {"text": "本会话之前的用户消息：" + " | ".join(p.strip()[:80] for p in prev)}
    return {"text": f"收到：{text.strip()}（本会话第 {len(users)} 条用户消息）"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quiet
        pass

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            self._json(200, {"object": "list", "data": [
                {"id": ARGS.model, "object": "model", "owned_by": "stub", "context_length": 131072}]})
        elif self.path.rstrip("/").endswith("/health") or self.path == "/":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        req = json.loads(self.rfile.read(length) or b"{}")
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self._json(404, {"error": {"message": f"unsupported path {self.path}"}})
            return
        messages = req.get("messages") or []
        stream = bool(req.get("stream"))
        has_tools = bool(req.get("tools"))
        decision = plan(messages) if has_tools or stream else {"text": "移动端测试会话"}
        users = [_text(m.get("content")) for m in messages if m.get("role") == "user"]
        _log({"t": time.time(), "stream": stream, "tools": has_tools,
              "last_role": (messages[-1].get("role") if messages else None),
              "last_user": (users[-1][:4000] if users else ""), "decision": decision.get("tool") or "text"})
        cid = "chatcmpl-" + uuid.uuid4().hex[:12]
        if not stream:
            msg = {"role": "assistant", "content": decision.get("text", "")}
            finish = "stop"
            if "tool" in decision:
                msg = {"role": "assistant", "content": None, "tool_calls": [{
                    "id": "call_" + uuid.uuid4().hex[:10], "type": "function",
                    "function": {"name": decision["tool"], "arguments": json.dumps(decision["args"], ensure_ascii=False)}}]}
                finish = "tool_calls"
            self._json(200, {"id": cid, "object": "chat.completion", "created": int(time.time()), "model": ARGS.model,
                             "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
                             "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}})
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def chunk(delta: dict, finish=None):
            payload = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": ARGS.model,
                       "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
            self.wfile.write(f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode())
            self.wfile.flush()

        try:
            chunk({"role": "assistant", "content": ""})
            if "tool" in decision:
                chunk({"tool_calls": [{"index": 0, "id": "call_" + uuid.uuid4().hex[:10], "type": "function",
                                       "function": {"name": decision["tool"], "arguments": ""}}]})
                chunk({"tool_calls": [{"index": 0, "function": {
                    "arguments": json.dumps(decision["args"], ensure_ascii=False)}}]})
                chunk({}, "tool_calls")
            else:
                text = decision["text"]
                slow = float(decision.get("slow") or 0)
                if slow > 0:
                    steps = max(1, int(slow / 0.5))
                    for i in range(steps):
                        chunk({"content": f"[进度 {i + 1}/{steps}] "})
                        time.sleep(0.5)
                    chunk({"content": "慢速任务完成。"})
                else:
                    for i in range(0, len(text), 8):
                        chunk({"content": text[i:i + 8]})
                        time.sleep(0.02)
                chunk({}, "stop")
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            _log({"t": time.time(), "event": "client_closed_stream", "last_user": users[-1][:200] if users else ""})
        self.close_connection = True


def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=18080)
    ap.add_argument("--model", default="stub-model")
    ap.add_argument("--log", default="")
    ARGS = ap.parse_args()
    srv = ThreadingHTTPServer((ARGS.host, ARGS.port), Handler)
    print(f"stub LLM listening on http://{ARGS.host}:{ARGS.port}/v1 model={ARGS.model}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
