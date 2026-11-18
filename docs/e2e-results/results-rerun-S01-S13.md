# 验收结果（真实 Hermes + 脚本化模型桩）

入口：https://hermes.test:8443　时间：2026-11-18T00:33:56.515Z

## S01 手机/平板/电脑尺寸适配与长内容渲染 — 通过（44s）
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

## S13 PWA：manifest、可安装性、安全区 — 通过（7s）
- ✅ manifest 可解析且无错误：[]
- ✅ Chrome 认为可安装（无 installability 错误）：[]
- ✅ manifest 不需要登录也可获取（浏览器拉取 manifest 不带 Cookie），且不含私有数据：200
- ✅ 模拟底部手势条 34px 时，内容区留出底部安全区：34px
- ✅ 聚焦输入框（键盘弹出）时去掉底部安全区留白：0px
- ✅ 没有注册 Service Worker、没有 Cache Storage（不缓存私有数据）：{"sw":0,"caches":0}
- 说明：安全区为 Chromium 模拟（Emulation.setSafeAreaInsetsOverride），不等于真机；iOS/Android 主屏安装需真机确认。
