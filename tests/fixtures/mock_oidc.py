#!/usr/bin/env python3
"""测试夹具：行为接近 Google 的 OpenID Connect 身份提供方（只用于验证 Hermes 的 Google 登录配置链路）。

与 Google 一致的地方：
  - /.well-known/openid-configuration 发现文档；授权码 + PKCE(S256)；
  - 机密客户端：令牌端点要求 client_secret（client_secret_basic 或 client_secret_post）；
  - ID Token 用 RS256 签名，含 iss/aud/sub/email/email_verified/name/iat/exp；
  - 只有授权请求带 access_type=offline 时才发 refresh_token（与 Google 相同）；刷新时返回新的 ID Token，refresh_token 不轮换；
  - 只允许“测试用户”名单中的账号登录（模拟 Google OAuth 同意屏幕的“测试”状态）。
不同的地方：不显示登录页，直接以 --email 指定的账号自动同意（--email 不在 --allow 名单时返回 access_denied）。

  python3 tests/fixtures/mock_oidc.py --port 18090 --client-id test-client --client-secret-file secret.txt \
          --redirect https://hermes.test:8443/auth/callback --email me@example.com --allow me@example.com --ttl 90
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

ARGS = None
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KID = secrets.token_hex(8)
CODES: dict[str, dict] = {}
REFRESH: dict[str, str] = {}  # refresh_token -> email
LOCK = threading.Lock()


def b64u(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def log(event: dict) -> None:
    if ARGS.log:
        with LOCK, open(ARGS.log, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"t": time.time(), **event}) + "\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    @property
    def issuer(self) -> str:
        return f"http://127.0.0.1:{ARGS.port}"

    def send_json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, url: str) -> None:
        self.send_response(302)
        self.send_header("Location", url)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == "/.well-known/openid-configuration":
            self.send_json(200, {
                "issuer": self.issuer,
                "authorization_endpoint": f"{self.issuer}/o/oauth2/v2/auth",
                "token_endpoint": f"{self.issuer}/token",
                "jwks_uri": f"{self.issuer}/oauth2/v3/certs",
                "revocation_endpoint": f"{self.issuer}/revoke",
                "response_types_supported": ["code"],
                "subject_types_supported": ["public"],
                "id_token_signing_alg_values_supported": ["RS256"],
                "scopes_supported": ["openid", "email", "profile"],
                "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
                "code_challenge_methods_supported": ["plain", "S256"],
            })
        elif u.path == "/oauth2/v3/certs":
            pub = KEY.public_key().public_numbers()
            self.send_json(200, {"keys": [{"kty": "RSA", "alg": "RS256", "use": "sig", "kid": KID, "n": b64u(pub.n), "e": b64u(pub.e)}]})
        elif u.path == "/o/oauth2/v2/auth":
            log({"event": "authorize", "client_id": q.get("client_id"), "redirect_uri": q.get("redirect_uri"),
                 "scope": q.get("scope"), "pkce": q.get("code_challenge_method"), "access_type": q.get("access_type"),
                 "prompt": q.get("prompt"), "login_hint": q.get("login_hint")})
            if q.get("client_id") != ARGS.client_id:
                return self.send_json(400, {"error": "invalid_client"})
            if q.get("redirect_uri") not in ARGS.redirect:
                return self.send_json(400, {"error": "redirect_uri_mismatch"})
            sep = "&" if "?" in q["redirect_uri"] else "?"
            if ARGS.email not in ARGS.allow:  # Google “测试”状态：不在测试用户名单 → 拒绝
                return self.redirect(f"{q['redirect_uri']}{sep}error=access_denied&state={urllib.parse.quote(q.get('state', ''))}")
            if q.get("response_type") != "code" or q.get("code_challenge_method") != "S256" or not q.get("code_challenge"):
                return self.send_json(400, {"error": "invalid_request"})
            code = secrets.token_urlsafe(24)
            with LOCK:
                CODES[code] = {"redirect_uri": q["redirect_uri"], "challenge": q["code_challenge"], "exp": time.time() + 120,
                               "offline": q.get("access_type") == "offline"}
            self.redirect(f"{q['redirect_uri']}{sep}code={code}&state={urllib.parse.quote(q.get('state', ''))}")
        else:
            self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        form = dict(urllib.parse.parse_qsl(self.rfile.read(length).decode()))
        if self.path == "/revoke":
            log({"event": "revoke"})
            return self.send_json(200, {})
        if self.path != "/token":
            return self.send_json(404, {"error": "not_found"})
        cid, csec = form.get("client_id"), form.get("client_secret")
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Basic "):
            cid, _, csec = base64.b64decode(auth[6:]).decode().partition(":")
            cid, csec = urllib.parse.unquote(cid), urllib.parse.unquote(csec)
        if cid != ARGS.client_id or csec != ARGS.client_secret:
            log({"event": "token_rejected", "reason": "client_auth"})
            return self.send_json(401, {"error": "invalid_client"})
        if form.get("grant_type") == "refresh_token":
            with LOCK:
                email = REFRESH.get(form.get("refresh_token", ""))
            if not email:
                log({"event": "token_rejected", "reason": "unknown_refresh_token"})
                return self.send_json(400, {"error": "invalid_grant"})
            log({"event": "refreshed"})
            return self.send_json(200, {"access_token": secrets.token_urlsafe(32), "id_token": self.id_token(email),
                                        "token_type": "Bearer", "expires_in": ARGS.ttl, "scope": "openid email profile"})
        with LOCK:
            entry = CODES.pop(form.get("code", ""), None)
        verifier = form.get("code_verifier", "")
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        if not entry or entry["exp"] < time.time() or entry["redirect_uri"] != form.get("redirect_uri") or entry["challenge"] != challenge:
            log({"event": "token_rejected", "reason": "code_or_pkce"})
            return self.send_json(400, {"error": "invalid_grant"})
        body = {"access_token": secrets.token_urlsafe(32), "id_token": self.id_token(ARGS.email), "token_type": "Bearer",
                "expires_in": ARGS.ttl, "scope": "openid email profile"}
        if entry["offline"]:
            body["refresh_token"] = secrets.token_urlsafe(32)
            with LOCK:
                REFRESH[body["refresh_token"]] = ARGS.email
        log({"event": "token_issued", "exp_in": ARGS.ttl, "auth": "basic" if auth.startswith("Basic ") else "post",
             "refresh_token": "refresh_token" in body})
        self.send_json(200, body)

    def id_token(self, email: str) -> str:
        now = int(time.time())
        claims = {"iss": self.issuer, "aud": ARGS.client_id, "sub": "1000000000000000000001", "email": email,
                  "email_verified": True, "name": "测试用户", "iat": now, "exp": now + ARGS.ttl, "azp": ARGS.client_id}
        return jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": KID})


def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18090)
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--client-secret-file", required=True)
    ap.add_argument("--redirect", action="append", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--allow", action="append", default=[])
    ap.add_argument("--ttl", type=int, default=3600)
    ap.add_argument("--log", default="")
    ARGS = ap.parse_args()
    ARGS.client_secret = open(ARGS.client_secret_file, encoding="utf-8").read().strip()
    print(f"mock OIDC issuer http://127.0.0.1:{ARGS.port} ttl={ARGS.ttl}s", flush=True)
    ThreadingHTTPServer(("127.0.0.1", ARGS.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
