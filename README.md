# 栖页 · Quiet Tab

一个纯前端、零运行时依赖的浏览器新标签页。中间搜索框、静态快捷方式、系统深色主题，以及本地图标缓存。没有统计、远程字体、背景图或 CDN 脚本依赖，无需自己的后台接口。每日一句直接调用一言 API。

## 直接部署

源码包内的 **dist/** 已经生成，可直接放到 Nginx、Caddy、GitHub Pages、Cloudflare Pages 或其他静态托管。支持根目录和子目录。建议启用 gzip / Brotli。

使用 HTTPS（本地开发可用 `http://localhost`），Service Worker 才能持久缓存图标和页面。不要直接双击 `index.html` 使用 `file://`：搜索与链接能工作，但本地图标缓存需要 Web 源。

推荐对 `index.html` 和 `sw.js` 使用 `Cache-Control: no-cache`，允许每次访问验证更新。JS/CSS 的引用包含构建版本参数，可正常使用服务器的 HTTP 缓存。不要给未版本化的 `index.html` / `sw.js` 设置长期 immutable。

## 编辑快捷方式

编辑根目录 `shortcuts.yaml`：

```yaml
shortcuts:
  - name: GitHub
    url: https://github.com
  - name: 文档
    url: https://example.com/docs
    icon: https://example.com/assets/logo.png
```

`name` 和 `url` 必填；`icon` 可选，默认是 URL 所属源的 `/favicon.ico`。URL / icon 仅接受 HTTP(S)，最多 48 项。`shortcuts: []` 可以隐藏快捷方式区域。填写 `icon` 不会引入图标 API 或代理，而是直接向该地址请求图片。

普通点击快捷方式会在新标签页打开目标网站，保留当前栖页；是否自动切换到新标签页由浏览器设置决定。Ctrl / Command 点击和鼠标中键仍遵循浏览器默认行为。

重新生成部署文件：

```bash
python3 -m pip install -r requirements.txt
python3 build.py
```

将新的 **dist/** 整体覆盖部署即可。Python 和 PyYAML 只用于构建，服务器和访问者浏览器都不需要它们。网页不解析 YAML，也不请求配置文件。

## 搜索

| 输入 | 引擎 |
| --- | --- |
| `关键词` | Google（默认） |
| `!g 关键词` / `!google 关键词` | Google |
| `!b 关键词` / `!bing 关键词` | Bing |
| `!d 关键词` / `!ddg 关键词` / `!duckduckgo 关键词` | DuckDuckGo |
| `!bd 关键词` / `!baidu 关键词` | 百度 |

命令不区分大小写，必须在开头并与关键词用空白分隔。不认识的命令按原文搜索。也可用左侧菜单选择引擎。手动选择仅在当前标签页有效，不改变默认 Google。命令单独输入时会提示补充关键词。

按 `/` 聚焦搜索框；按 `Esc` 关闭菜单或退出输入。引擎菜单支持方向键、Home、End、Enter 和 Escape。首次打开不强制聚焦，以免在手机上弹出键盘。

## 每日一句

“栖页” Logo 与名称位于句子上方；句子用较小字体显示。每日一句使用 [一言 API](https://developer.hitokoto.cn/sentence/) 的随机句子，并显示作者与出处（如果接口返回）。请求使用 JSON 模式和短句长度上限，正文只作为文本插入，不执行 API 返回的代码。

每个浏览器源用 localStorage 缓存句子及上次请求时间。**每 24 小时最多请求一次**，刷新页面、重开新标签页会恢复缓存；24 小时是从请求时刻计算，而不是每天零点。到期时在页面可见状态下刷新，隐藏的页面恢复可见时检查到期。支持 Web Locks 的浏览器会把多个标签页的请求串行化，避免同时重复请求。

API 不可达、超时或返回无效数据时继续显示上一句；从未成功获取时显示默认占位句。失败的请求同样计入 24 小时周期，避免重复刷新冲击 API。关闭本地存储时只在当前标签页内缓存，重新打开页面将再次请求。清理站点数据会重置周期。

调用地址：`https://v1.hitokoto.cn/?encode=json&min_length=6&max_length=28`，请求超时 6 秒。它不阻塞搜索框、快捷方式或图标加载。不同浏览器独立缓存，句子可能不同。

## 图标与缓存的实际行为

1. 页面 HTML 预先包含所有快捷方式和字母占位图标，搜索与布局不等待图标网络请求。
2. 第一次打开新标签页时，在 Service Worker 就绪后异步加载各快捷方式的网站图标，直接请求 YAML 图标地址；后续打开只要已有 Worker 控制页面，立即加载图标，不等待注册或更新检查。部署时若旧 Worker 拒绝新配置的图标，新 Worker 接管后会重试失败或仍在等待的图标；已显示的图标不会重复加载。图片加载成功前保持隐藏，但不使用懒加载，避免隐藏状态阻止请求。Worker 获取远端图标时不发送 Cookies 或来源页面信息。
3. 成功获取的图片响应保存在本源的 Cache Storage 中。后续打开直接用本地响应，不再次向图标站点请求；重复的图标 URL 共用一个条目。
4. 无图标、404、网络错误或图片无法解码时保留字母占位。失败 URL 从实际失败时刻起暂停重试 24 小时；刷新或重开页面不会延长暂停时间。修复版首次激活时清除旧版错误续期的失败记录，但保留成功缓存的图标。修改 YAML 并重新部署后，不再使用的缓存会被移除。
5. HTTPS 下的 HTTP 图标会被跳过。站点防盗链、CORP 策略或网络不可达也可能导致图标失败；可指定可访问的 HTTPS `icon`。当前配置已为 Glance、SilverBullet 和 ChatGPT 指定可公开访问的静态图标，避免默认 `/favicon.ico` 的 404、登录页重定向或跨域限制；若上游调整带版本号的资源路径，需同步更新配置。
6. 禁止浏览器存储、私密模式限制或不支持 Service Worker 时，退化为普通远端图片与字母占位，搜索和链接继续工作。浏览器清理站点数据会删除缓存。

普通网页**不能监听其他标签页的访问记录，也不能读取任意跨域页面的 HTML 来发现 `<link rel="icon">`**。这里的“自动抓取”是首次访问新标签页时按快捷方式 URL 获取惯例路径图标，不是监听跳转后的目标页面。如果必须读取目标页面的实际 favicon 声明或基于全浏览器访问记录触发，需要浏览器扩展权限。

对于不允许 CORS 的网站，Service Worker 使用 `no-cors` 请求保存 opaque 图片响应，随后只把它返回给 `no-cors` 图片请求，不读取或转换图片内容。浏览器可能对 opaque 响应使用较大的配额计数；缓存数量限制为当前配置的唯一图标数，避免无限增长。相关机制见 [MDN respondWith](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith) 与 [Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)。

页面资源也会缓存：Worker 完成首次安装后，再次打开页面会优先读取当前版本的本地 HTML、CSS 和 JavaScript，不等待服务器返回 HTML；断网仍可打开搜索界面与已缓存图标。缓存缺失或存储被禁用时回退到网络，且只接管部署目录首页，不拦截其他路径。提交网络搜索和打开外站仍需网络。

每次打开仍会注册 Worker 并在后台检查更新。部署新版本后，新 Worker 会先完整缓存新版本页面资源，再接管页面并清理旧页面缓存，同时保留仍在配置中的图标缓存。**更新安装完成后，下次打开或刷新页面使用新版本**，当前已打开页面不会被强制刷新；若恰好在后台更新完成前打开，可能仍看到上一版本。

## 浏览器新标签页设置

把部署地址设为主页即可从主页入口打开。Chrome / Firefox 的“新标签页”不是普通主页设置；要替换每次新建标签页的内容，通常需要支持自定义新标签 URL 的扩展，或将这份页面打包为浏览器扩展。此项目提供网页本身，不安装扩展，也不修改浏览器设置。

## 文件与检查

- `shortcuts.yaml`：固定快捷方式配置。
- `src/`：可编辑的 HTML、CSS、JavaScript 和 Service Worker 源码。
- `build.py`：安全读取 YAML，生成快捷方式 HTML、合并 JavaScript、注入版本号。
- `dist/`：可直接部署的纯静态文件。
- `tests/`：搜索指令 / 编码、配置校验、图标缓存、每日一句 24 小时缓存与失败回退的检查。

```bash
python3 build.py
python3 -m unittest discover -s tests -p '*_test.py'
node --test tests/*.test.mjs
```

页面主体约 29 KB 未压缩（不含按需获取的远端图标），实际大小由快捷方式数决定。使用系统字体。主题依赖 `prefers-color-scheme`，无需 JavaScript 同步；快捷方式每行最多六个，每一行都居中；窄屏自动减少每行个数。主体在当前动态视口居中基础上整体上移视口高度的 4%（最多 32px），空间不足时自动减小偏移，间距和字体根据窗口调整；高度不足时根据实际内容尺寸整体缩小，使所有快捷方式保持在单屏内。没有页头、页脚、帮助弹窗或可见指令提示。键盘快捷键和搜索指令仍然可用。页面支持减少动态效果设置。

测试验证业务逻辑及缓存控制；浏览器真实渲染与外站图标可达性需要在目标浏览器检查，具体图标是否可用取决于网络与目标网站策略。
