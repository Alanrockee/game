"""Google 账号登录 —— Hermes Dashboard / Webapp 登录提供方插件（官方 DashboardAuthProvider 扩展点）。

在官方 ``self_hosted``（通用 OIDC）实现之上补三件事：
  1. 只允许白名单里的 Google 邮箱登录（必须 email_verified）。官方 OIDC 只校验“是有效的
     Google 账号”，不校验是不是你本人，而登录者拥有与主机用户相同的权限。
  2. 授权请求附加 ``access_type=offline&prompt=consent``，让 Google 发放 refresh token。
     否则 Google 的 ID Token 1 小时就过期，网页每小时都要重新登录。
  3. 登录按钮显示为“Google”。

配置（写在 ~/.hermes/.env 或 %LOCALAPPDATA%\\hermes\\.env）：
  HERMES_DASHBOARD_GOOGLE_CLIENT_ID       Google Cloud 里“Web 应用”类型 OAuth 客户端的 ID
  HERMES_DASHBOARD_GOOGLE_CLIENT_SECRET   对应的客户端密钥（只存在本机）
  HERMES_DASHBOARD_GOOGLE_ALLOWED_EMAILS  允许登录的邮箱，逗号分隔；为空时插件拒绝启用（失败即关闭）
  HERMES_DASHBOARD_GOOGLE_ISSUER          仅测试用，默认 https://accounts.google.com
启用：hermes plugins enable dashboard-auth-google，然后重启网关。
"""
from __future__ import annotations

import logging
import os
import urllib.parse
from typing import Any, Optional

from hermes_cli.dashboard_auth import InvalidCodeError, LoginStart, Session
from plugins.dashboard_auth.self_hosted import SelfHostedOIDCProvider

logger = logging.getLogger("hermes.dashboard_auth.google")
GOOGLE_ISSUER = "https://accounts.google.com"


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


class GoogleProvider(SelfHostedOIDCProvider):
    name = "google"
    display_name = "Google"
    # Google 的 refresh token 不轮换、用过仍然有效（官方文档要求此类提供方关闭重放检测）。
    refresh_reuse_detection = False

    def __init__(self, *, allowed_emails: set[str], **kw: Any) -> None:
        super().__init__(**kw)
        self._allowed = {e.strip().lower() for e in allowed_emails if e.strip()}
        if not self._allowed:
            raise ValueError("allowed_emails is required")

    def start_login(self, *, redirect_uri: str) -> LoginStart:
        start = super().start_login(redirect_uri=redirect_uri)
        extra = {"access_type": "offline", "prompt": "consent"}
        if len(self._allowed) == 1:
            extra["login_hint"] = next(iter(self._allowed))
        sep = "&" if "?" in start.redirect_url else "?"
        return LoginStart(redirect_url=start.redirect_url + sep + urllib.parse.urlencode(extra),
                          cookie_payload=start.cookie_payload)

    def _session(self, id_token: str, refresh_token: str, claims: dict[str, Any]) -> Session:
        email = str(claims.get("email") or "").strip().lower()
        if claims.get("email_verified") is not True or email not in self._allowed:
            logger.warning("dashboard-auth-google: rejected sign-in for %s (not in allowed list or unverified)",
                           email or "<no email>")
            # 登录时 → 400（不建立会话）；刷新时 → 官方逻辑转为 RefreshExpiredError（会话结束）
            raise InvalidCodeError("this Google account is not allowed to sign in")
        return super()._session(id_token, refresh_token, claims)

    def verify_session(self, *, access_token: str) -> Optional[Session]:
        try:
            return super().verify_session(access_token=access_token)
        except InvalidCodeError:
            return None


def register(ctx) -> None:
    client_id = _env("HERMES_DASHBOARD_GOOGLE_CLIENT_ID")
    if not client_id:
        logger.info("dashboard-auth-google: not configured (HERMES_DASHBOARD_GOOGLE_CLIENT_ID unset)")
        return
    allowed = {e for e in _env("HERMES_DASHBOARD_GOOGLE_ALLOWED_EMAILS").split(",") if e.strip()}
    if not allowed:
        logger.error("dashboard-auth-google: refusing to register — HERMES_DASHBOARD_GOOGLE_ALLOWED_EMAILS is empty")
        return
    provider = GoogleProvider(
        issuer=_env("HERMES_DASHBOARD_GOOGLE_ISSUER") or GOOGLE_ISSUER,
        client_id=client_id,
        client_secret=_env("HERMES_DASHBOARD_GOOGLE_CLIENT_SECRET"),
        scopes="openid email profile",
        allowed_emails=allowed,
    )
    ctx.register_dashboard_auth_provider(provider)
    logger.info("dashboard-auth-google: registered (allowed accounts: %d, confidential=%s)",
                len(allowed), bool(_env("HERMES_DASHBOARD_GOOGLE_CLIENT_SECRET")))
