# 验收结果（真实 Hermes + 脚本化模型桩）

入口：https://hermes.test:8443　时间：2026-11-18T00:31:32.913Z

## S01 手机/平板/电脑尺寸适配与长内容渲染 — 通过（50s）
- ✅ phone360 页面无横向撑破：{"docScrollWidth":360,"innerWidth":360,"offenders":[]}
- ✅ phone360 超长代码行在代码块内横向滚动（或宽屏可完整显示）：true
- ✅ phone360 宽表格局部横向滚动（或宽屏可完整显示）：true
- ✅ phone360 输入框在可视区域内：{"top":664,"bottom":696,"h":780}
- ✅ phone360 输入框字号 ≥16px（iOS 不会自动放大）：16px
- ✅ phone390 页面无横向撑破：{"docScrollWidth":390,"innerWidth":390,"offenders":[]}
- ✅ phone390 超长代码行在代码块内横向滚动（或宽屏可完整显示）：true
- ✅ phone390 宽表格局部横向滚动（或宽屏可完整显示）：true
- ✅ phone390 输入框在可视区域内：{"top":728,"bottom":760,"h":844}
- ✅ phone390 输入框字号 ≥16px（iOS 不会自动放大）：16px
- ✅ 390 宽、模拟键盘弹出后输入框仍可见：{"top":392,"bottom":424}
- ✅ 消息/代码有“复制”按钮：2
- ✅ 向上阅读时出现“滚动到底部”按钮：true
- ✅ phone430 页面无横向撑破：{"docScrollWidth":430,"innerWidth":430,"offenders":[]}
- ✅ phone430 超长代码行在代码块内横向滚动（或宽屏可完整显示）：true
- ✅ phone430 宽表格局部横向滚动（或宽屏可完整显示）：true
- ✅ phone430 输入框在可视区域内：{"top":816,"bottom":848,"h":932}
- ✅ phone430 输入框字号 ≥16px（iOS 不会自动放大）：16px
- ✅ tablet 页面无横向撑破：{"docScrollWidth":820,"innerWidth":820,"offenders":[]}
- ✅ tablet 超长代码行在代码块内横向滚动（或宽屏可完整显示）：true
- ✅ tablet 宽表格局部横向滚动（或宽屏可完整显示）：true
- ✅ tablet 输入框在可视区域内：{"top":1106,"bottom":1138,"h":1180}
- ✅ desktop 页面无横向撑破：{"docScrollWidth":1280,"innerWidth":1280,"offenders":[]}
- ✅ desktop 超长代码行在代码块内横向滚动（或宽屏可完整显示）：true
- ✅ desktop 宽表格局部横向滚动（或宽屏可完整显示）：true
- ✅ desktop 输入框在可视区域内：{"top":735,"bottom":764,"h":800}
- ✅ 系统深色模式下界面为深色：color(srgb 0.0509804 0.0625882 0.0810196)
- 说明：键盘弹出为“缩小视口”模拟，不等于真机软键盘；真机需人工确认。

## S02 中文输入法选词时 Enter 不误发送 — 通过（9s）
- ✅ 组合输入中（isComposing=true）按 Enter 不发送
- ✅ Safari 式“结束组合后紧跟 229 Enter”不发送
- ✅ 普通 Enter 正常发送且只发送一次：1

## S03 真实 Agent 工具调用（临时目录写文件） — 通过（5s）
- ✅ 文件由 Hermes 工具真实写入（经官方 REST 读取核对）：{"status":200}
- ✅ 该任务只到达模型一次

## S04 两个客户端同步同一会话（电脑 A ↔ 手机 B） — 通过（23s）
- ✅ B 的会话列表包含 A 新建的会话：local-c6668a1ca2180d9f34ec1078aa29852724e9998721c6bcec54ff3d6ac01cb3b0
- ✅ B 打开后看到 A 的消息与回复
- ✅ A 无需刷新即看到 B 的新消息与回复
- ✅ 上下文连续（第三轮能看到前两轮）：本会话之前的用户消息：同步-甲-7e74c3 | 同步-乙-7e74c3
- ✅ 甲消息只执行一次：1
- ✅ 服务端历史无重复用户消息：["同步-甲-7e74c3","同步-乙-7e74c3","[recall]"]
- ✅ 会话属于当前 profile（default）：default
- ✅ 带正确版本号重命名成功：{"status":200,"rev":3,"body":"{\"ok\":true,\"session_id\":\"local-c6668a1ca2180d9f34ec1078aa29852724e9998721c6bcec54ff3d6ac01cb3b0\",\"revision\":4,\"execution_generation\":3,\"operation\":\"sidebar\",\"title\":\"同步改名-7e74c3\"}"}
- ✅ 同一 request_id 重试返回原回执（幂等，不再次修改）：{"status":200,"body":"{\"ok\":true,\"execution_generation\":3,\"operation\":\"sidebar\",\"revision\":4,\"session_id\":\"local-c6668a1ca2180d9f34ec1078aa29852724e9998721c6bcec54ff3d6ac01cb3b0\",\"ti"}
- ✅ 用过期版本号改名被拒绝（冲突提示，而不是静默覆盖）：{"status":409,"body":"{\"detail\":\"revision_conflict\"}"}
- ✅ B 实时看到新标题

## S05 接续电脑端 CLI 会话（双向） — 通过（19s）
- ✅ CLI 新建会话并返回会话 ID：local-abdd55481acf242731e0897d904c31b9d722c5c9a8f5e0ec261eca60ba1f56f3
- ✅ 手机端打开后看到 CLI 会话历史
- ✅ 手机端可以在 CLI 会话里继续提问（未被拒绝为只读）
- ✅ CLI --resume 后上下文里能看到手机端的消息：本会话之前的用户消息：电脑-丙-e7c68e | 手机-丁-e7c68e
- ✅ CLI 新消息实时出现在手机端
- 说明：Hermes v0.23.2 中 CLI 与 Webapp 由同一个 Gateway 执行；网关接管之前写下的旧会话需先运行 `hermes sessions adopt`。

## S06 关闭页面后任务继续，重新打开恢复结果 — 通过（26s）
- ✅ 重新打开后看到完整结果
- ✅ 服务端历史中该轮已完成
- ✅ 模型只被调用一次（重连没有重复执行）：1
- ✅ 模型流没有被中途切断

## S06b 实时连接中途断开（模拟切网），自动重连补齐输出 — 通过（15s）
- ✅ 测试入口确实断开了实时连接：1
- ✅ 同一页面在断线后自动恢复并显示最终结果
- ✅ 只执行一次：1
- ✅ 最终输出没有重复段落：1
- 说明：断开后 1.5 秒页面状态片段：（无连接提示）

## S07 重复点击、响应丢失与离线 — 通过（120s）
- ✅ 快速连按两次 Enter 只提交一次：1
- ✅ 测试入口在提交瞬间断开了实时连接：1
- ✅ 回执丢失后没有被自动重复执行（模型调用 ≤ 1）：{"turns":0}
- ✅ 服务端历史中该消息不重复：{"rows":0}
- ✅ 离线模拟：已有实时连接被断开：1
- ✅ 离线时状态栏不再显示“后端 就绪”：
- ✅ 离线期间消息没有到达模型
- ✅ 离线时输入内容没有丢失（仍在输入框或显示为未送达）
- ✅ 恢复网络后自动重连（状态栏回到就绪）：后端 就绪 | 后端 v0.23.2
- ✅ 离线时未送达的消息恢复后不会被重复执行（≤ 1 次）：0
- 说明：回执丢失后：模型调用 0 次，服务端用户消息 0 条；页面出现了待核对/失败提示。
- 说明：离线 8 秒后状态栏：；页面提示片段：offline
- 说明：离线按发送后：草稿仍显示在页面（输入框，见截图 S07-offline-send）；页面提示片段：离线草稿-cada36
- 说明：恢复网络 25 秒后，离线时按下发送的那条消息到达模型 0 次（0 = 需用户手动重发；1 = 恢复后以同一 submission_id 送达一次）。

## S08 停止任务：取消请求真正到达后端 — 通过（30s）
- ✅ 后端中止了上游模型请求（模型桩记录到流被关闭）
- ✅ 停止后“停止”按钮消失、回到可输入状态：0
- ✅ 被取消的任务没有在后台继续跑完
- ✅ 取消没有触发重新执行

## S09 工具批准：两端可见、绑定到具体命令、拒绝/批准均生效 — 通过（20s）
- ✅ 电脑端也看到同一个待批准命令（卡片显示具体命令）
- ✅ 拒绝后命令没有执行（文件仍在）：200
- ✅ 拒绝后电脑端的批准卡片失效：0
- ✅ 电脑端批准后命令执行（文件已删除）：404
- ✅ 批准后手机端卡片随之消失，不能重复批准：0
- 说明：测试实例使用 approvals.mode=manual 以便确定性复现；部署时保留你现有的批准设置（默认 smart）。

## S10 文件：手机上传 → Hermes 实际读取 → 另一端下载生成结果 — 通过（11s）
- ✅ 上传接口成功：200
- ✅ 附件内容进入了模型上下文
- ✅ Hermes 用 read_file 工具实际读到了服务器上的附件文件
- ✅ 电脑端（另一登录）可下载 Hermes 生成的文件：200
- ✅ 下载为附件形式（不在页面内执行）：attachment; filename="report-28e96d.md"
- ✅ 图片上传成功：{"url":"/api/chat/file-upload?profile=default","status":200}
- 说明：附件保存位置（相对会话工作目录）：.hermes/attachments/web-626a330976529ca5-note-28e96d.txt
- 说明：“图片…”选择器 accept=.png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff（手机上会提供拍照/相册）

## R01 真实模型：手机端对话并收到回复 — 跳过（0s）
- 说明：仅在接真实模型时运行

## R02 真实模型：调用工具在临时目录写文件并核对 — 跳过（0s）
- 说明：仅在接真实模型时运行

## S13 PWA：manifest、可安装性、安全区 — 通过（8s）
- ✅ manifest 可解析且无错误：[]
- ✅ Chrome 认为可安装（无 installability 错误）：[]
- ✅ manifest 不需要登录也可获取（浏览器拉取 manifest 不带 Cookie），且不含私有数据：200
- ✅ 模拟底部手势条 34px 时，内容区留出底部安全区：34px
- ✅ 聚焦输入框（键盘弹出）时去掉底部安全区留白：0px
- ✅ 没有注册 Service Worker、没有 Cache Storage（不缓存私有数据）：{"sw":0,"caches":0}
- 说明：安全区为 Chromium 模拟（Emulation.setSafeAreaInsetsOverride），不等于真机；iOS/Android 主屏安装需真机确认。

## S11 登录、权限与安全 — 通过（33s）
- ✅ 未登录访问首页被重定向到登录页
- ✅ 未登录读取会话列表被拒绝
- ✅ 未登录下载文件被拒绝
- ✅ 未登录读取配置被拒绝
- ✅ 未登录无法申请实时连接票据：401
- ✅ 未登录 WebSocket 握手不成功：403
- ✅ 错误密码被拒绝（401）：401
- ✅ 不存在的用户与错误密码返回相同结果（不泄露用户名是否存在）：[401,401]
- ✅ 状态接口报告 auth_required=true：["basic"]
- ✅ 登录 Cookie 均为 __Host- 前缀 + HttpOnly + Secure + SameSite=Lax：["__Host-hermes_session_at_953b5 true/true/Lax","__Host-hermes_session_rt_953b5 true/true/Lax","__Host-hermes_session_provider true/true/Lax","__Host-hermes_webapp_signin_95 true/true/Lax"]
- ✅ 浏览器存储中没有会话 Cookie 值
- ✅ 页面 HTML 不含服务端密钥：3 个探针
- ✅ 拒绝下载 Hermes 的 .env 凭证文件：403
- ✅ 路径穿越到 .env 被拒绝：403
- ✅ 拒绝下载正在使用的会话数据库：409
- ✅ 通过符号链接指向 .env 被拒绝：403
- ✅ 模型输出中的 <img onerror>/<script>/<iframe> 不执行：{}
- ✅ javascript: 链接被清除：0
- ✅ 上传的 HTML 只以附件（Content-Disposition: attachment）下载，不在站内渲染：{"cd":"attachment; filename=\"web-fce57b23b233fb4c-evil.html\"","ct":"text/html; charset=utf-8"}
- ✅ 页面带 CSP（禁止内联脚本、禁止被嵌入）：default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval' 'sha256-DNLyvt92UPFLouRKgpya9MqQxHI26V91n5jyyY6S2bs=' 'sh
- ✅ 前置条件：未发送草稿已保存在本机（刷新不丢）
- ✅ 退出登录成功并回到登录页：界面：设置 → 网关 → 退出登录
- ✅ 退出后本机不再保留草稿、待确认提交、队列和最近会话等私密状态：{"hit":[],"drafts":[],"session":0}
- ✅ 退出后旧 Cookie 重放被拒绝（服务端已撤销）：401
- ✅ 退出后下载接口同样失效：401
- ✅ 退出后，另一个标签页已打开的实时连接不能再提交任务：{"tab2Status":"","turns":0}
- 说明：其他 Cookie（非凭证，仅界面偏好）：sidebar_state
- 说明：下载响应 X-Content-Type-Options=（未设置）；attachment 已阻止浏览器内联渲染。
- 说明：退出 5 秒后另一个标签页状态栏：；URL：/login

## S12 网关进程崩溃/重启：历史保留、中断任务不被静默重跑 — 通过（67s）
- ✅ 重启后历史消息与已完成结果仍在
- ✅ 中断的任务没有在重启后被自动重新执行：0
- ✅ 中断的任务没有被标成“完成”
- ✅ 界面把中断的轮次标为“已暂停/已丢失”，等待用户决定（而不是自动重跑）：1 条排队 — 已暂停

## S14 登录尝试速率限制 — 通过（0s）
- ✅ 连续错误登录后触发 429 限流：401,401,401,401,401,401,401,401,401,429,429,429,429
- 说明：限流按客户端 IP、每分钟窗口计算；本场景放在最后执行，避免影响其他场景登录。
