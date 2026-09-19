# LAN Office · GitHub 开源项目调研报告

> 调研日期：2026-09-19。调研工具：GitHub API（仓库元数据）、GitHub 搜索、Web 搜索、官方集成示例源码阅读。
> 结论先行：**没有发现任何一个现成开源项目能直接满足"Windows 双击启动的局域网多人 Office 协同编辑"**，
> 但存在一个成熟、免费、可在 Windows 原生运行、自带实时协同的 Office 编辑引擎——**ONLYOFFICE Document Server（Community Edition）**。
> 因此本项目采用"复用成熟编辑引擎 + 自研轻量 Node.js 局域网服务层"的组合方案。

---

## 一、搜索方向记录

按任务要求依次搜索了以下关键词（GitHub / GitHub Releases / Issues / README / Web）：

- LAN collaborative document editor / local network office collaboration
- self hosted office collaboration / self hosted document editor
- real time collaborative office editor / LAN file collaboration
- OnlyOffice collaboration / Collabora Online collaboration
- WebSocket document collaboration / CRDT office editor / OT collaborative editor
- open source Word Excel PowerPoint web editor
- github LAN collaborative office editor windows "start.bat" self-hosted node.js

**关键发现**：搜索 `LAN collaborative office editor + start.bat + windows` 没有命中任何已知的、可直接使用的同类项目。
市面上的自托管 Office 协同产品（Nextcloud/ownCloud + OnlyOffice、Seafile、CryptPad 等）都以"服务器部署"为前提，
没有一个面向"家庭/学校/小办公室普通 Windows 用户、双击即用"的形态。这就是本项目的定位空间。

## 二、候选项目对比总表

数据来源：GitHub API（2026-09-19 查询）。

| 项目 | Star | License | 最近更新 | 技术 | 自托管 | 局域网可用 | Word/Excel/PPT | 实时协同 | Windows 原生 | 需要 Docker |
|---|---|---|---|---|---|---|---|---|---|---|
| [ONLYOFFICE/DocumentServer](https://github.com/ONLYOFFICE/DocumentServer) | 6.9k | AGPL-3.0 | 2026-07 | C++/JS 编辑引擎 + Node 服务 | ✅ | ✅ | ✅✅✅（真实编辑） | ✅ 内置（OT 类） | ✅ 有 Windows 安装包 | 可选 |
| [ONLYOFFICE/document-server-integration](https://github.com/ONLYOFFICE/document-server-integration) | 218 | Apache-2.0 | 2026-08 | 官方集成示例（含 Node.js） | ✅ | ✅ | （示例） | （示例） | ✅ | 否 |
| [CollaboraOnline/online](https://github.com/CollaboraOnline/online) | 3.3k | MPL-2.0（源码） | 2026-09 | LibreOffice Kit + C++ | ✅ | ✅ | ✅✅✅ | ✅ | ❌ 无原生版 | 基本必须 |
| [cryptpad/cryptpad](https://github.com/cryptpad/cryptpad) | 7.9k | AGPL-3.0 | 2026-09 | Node.js + 内嵌 OnlyOffice | ✅ | ✅ | ✅✅✅（经转换） | ✅ | ✅（Node） | 否 |
| [dream-num/univer](https://github.com/dream-num/univer) | 14.4k | Apache-2.0 | 2026-09 | TypeScript 全栈 | ✅ | ✅ | ⚠️ 表格强 / 文档演示弱 / PPT 弱 | ⚠️ 协同能力主要在商业版 | ✅ | 否 |
| [ether/etherpad](https://github.com/ether/etherpad) | 18.6k | Apache-2.0 | 2026-09 | Node.js | ✅ | ✅ | ❌ 无真实 Office 文件编辑 | ✅ 键级 OT | ✅（Node） | 否 |
| [yjs/yjs](https://github.com/yjs/yjs) | 22.8k | MIT（源码） | 2026-09 | CRDT 库 | — | — | ❌（是库不是编辑器） | ✅ CRDT | — | — |
| [share/sharedb](https://github.com/share/sharedb) | 6.5k | MIT（源码） | 2026-09 | OT 库 | — | — | ❌ | ✅ OT | — | — |
| [filebrowser/filebrowser](https://github.com/filebrowser/filebrowser) | 35.9k | Apache-2.0 | 2026-07（已归档） | Go | ✅ | ✅ | ❌ 仅文件管理 | ❌ | ✅ | 否 |
| [gristlabs/grist-core](https://github.com/gristlabs/grist-core) | 11.8k | Apache-2.0 | 2026-09 | Node/Python | ✅ | ✅ | ⚠️ 表格类（非 xlsx 保真） | ✅ | ⚠️ | 建议 |
| [nextcloud/richdocuments](https://github.com/nextcloud/richdocuments) | 453 | AGPL-3.0 | 2026-09 | Nextcloud 的 Collabora 集成 | ✅ | ✅ | （依赖 Collabora） | ✅ | ❌ | 依赖侧 |

## 三、重点项目分析（20 项维度）

### 1. ONLYOFFICE Document Server ⭐ 最终选定的核心引擎

1. **名称**：ONLYOFFICE Docs / Document Server（Community Edition）
2. **地址**：https://github.com/ONLYOFFICE/DocumentServer
3. **Star**：6,912
4. **最近更新**：2026-07（持续活跃，官方商业公司维护）
5. **License**：**AGPL-3.0**（Community Edition 免费商用、不限用户数；作为独立服务进程通过 HTTP API 集成是 AGPL 明确允许的典型用法）
6. **主要技术**：C++/JS 的 Office 编辑内核（sdkjs/core），对外提供 HTTP 服务 + 浏览器 JS API
7. **自托管**：✅ 完整支持
8. **局域网**：✅ 纯 HTTP(S) 服务，无外网依赖
9. **Word (.docx)**：✅ 真实编辑（保留格式的 OOXML 原生编辑，非转换）
10. **Excel (.xlsx)**：✅ 真实编辑
11. **PowerPoint (.pptx)**：✅ 真实编辑
12. **多人实时协同**：✅ **引擎内置**（同一 document.key 的用户自动进入同一编辑会话，实时看到彼此的光标与修改，基于服务端合并的类 OT 机制）
13. **Windows**：✅ **有官方 Windows 安装包**（另附 Docker 镜像）
14. **是否需要 Docker**：❌ Windows 上可用原生安装包
15. **是否需要公网服务器**：❌
16. **离线/局域网运行**：✅
17. **优点**：三件套格式保真度业界开源最佳；协同编辑开箱即用；提供完整的集成 API（编辑器配置、回调保存、命令服务、JWT 安全）；官方文档齐全且有 Apache-2.0 的官方集成示例；支持 doc/xls/ppt/odt/ods/odp/csv/txt 等更多格式与 PDF 查看
18. **缺点**：引擎较重（安装包 GB 级、内存约需 2-4GB）；Windows 版默认 80 端口、7.2+ 默认启用 JWT（需读取/配置 local.json 密钥）；社区版有 OnlyOffice 品牌界面；不是"双击即用"，需要一次性安装
19. **值得借鉴**：`document.key` 版本化策略（保存后更换 key）、回调保存流程（status 2/3/6/7 + 下载 url）、"保存前先备份上一版"的版本目录设计（官方示例 version/prev 文件）、`forcesave`/`meta` 命令服务、断开时自动触发 forcesave 的时机（status 1 + actions[type=0]）
20. **不应照搬**：官方示例的"文件名即路径"存储方式（存在路径穿越与特殊文件名隐患，本项目改为 UUID 元数据索引）；示例不处理中文文件名编码；示例把所有逻辑塞在单文件 app.js（本项目模块化）

### 2. Collabora Online（LibreOffice Online 的商业维护版）— 评估后放弃

1-5. 3,348★（GitHub 仅 issue 跟踪，开发在 Gerrit）；MPL-2.0；活跃。
6-16. 基于 LibreOffice Kit，支持三件套真实编辑与协同，可自托管、可局域网；**但没有 Windows 原生版**——官方只支持 Docker 镜像（`collabora/code`）或 Linux 原生包，Windows 上必须 Docker Desktop / WSL2（调研确认："No native Windows install is supported"）。
17. 优点：LibreOffice 内核兼容性好、文档协议开放。
18. 缺点：Windows 部署门槛对普通用户过高（Docker Desktop 需要许可证/WSL2）；协同体验与移动端不如 OnlyOffice；与 Nextcloud 生态绑定较深。
19. **值得借鉴**：WOPI 协议的"文件锁 + 版本"思路。
20. 不应照搬：在本项目中引入 Docker 依赖（违背"双击 BAT 即用"的目标）。

### 3. CryptPad — 评估后不采用（形态不匹配）

7,930★，AGPL-3.0，活跃。Node.js 可直接跑（无需 Docker），内嵌 OnlyOffice 实现三件套协同。
优点：端到端加密、隐私强。缺点：产品形态是"加密网盘/加密协作文档"，文件上传后被转为内部加密格式，不是"局域网共享文件夹里的原文件直接多人编辑"；UX 与本项目"文件列表 + 打开即编辑"差异大，改造成本高于自研集成层。
**借鉴点**：它证明了"OnlyOffice 引擎 + Node.js 服务层"组合在 Node 环境的可行性。

### 4. Univer — 评估后不作为核心（覆盖不全）

14,409★，Apache-2.0，活跃，国产全栈 Office 运行时。表格能力最强、格式导入导出在进步；但文档/演示的 docx/pptx 保真编辑与实时协同（开源版）尚不完整——协同编辑能力主要在商业版。License 友好（Apache-2.0），是 Excel 方向的优质备选，但无法同时满足三件套，违背"宁可减少功能，也不做假功能"原则。
**借鉴点**：前端"按类型分色图标"的文件呈现方式。

### 5. Etherpad — 不适用但模式值得学习

18,553★，Apache-2.0（新版本已迁到 Apache），Node.js，键级 OT 的纯文本协同鼻祖。没有真实 Office 文件编辑能力。
**借鉴点**：presence（在线用户/颜色/昵称）与断线重连的交互设计；"每个按键都署名"的协同状态展示。

### 6. Yjs / ShareDB — 不直接使用

22,813★ MIT / 6,537★ MIT。分别是 CRDT 与 OT 的通用库。**它们的用途是"自研协同编辑器"**，而本项目已经由 OnlyOffice 引擎内置了协同机制，按"不要为了用 CRDT/OT 而用 CRDT/OT"的原则，不引入。
（如果未来做"纯文本/Markdown 协同"，Yjs 是首选。）

### 7. filebrowser/filebrowser — 文件管理参考

35,948★，Apache-2.0，**已归档**（2026-07）。Go 单二进制文件管理器，上传/下载/重命名/删除 UX 成熟。
**借鉴点**：文件卡片信息密度（大小/时间/操作）、拖拽上传、面包屑；其"已归档"状态也提醒我们：文件管理层值得自己掌握，保持轻量可控。

### 8. nextcloud/richdocuments 与 onlyoffice 集成类应用 — 架构参考

453★ AGPL-3.0。它们演示了"自有平台 + 独立编辑引擎"的标准集成模式：回调保存、key 管理、权限透传。本项目本质上就是这个模式的最小化、去中心化账号版本。

### 9. Grist — 同类定位参考

11,821★ Apache-2.0。"表格数据库"形态，不是 xlsx 保真编辑器，作为对比项记录。

## 四、为什么最终选择"ONLYOFFICE DS + 自研 Node.js 服务层"

| 决策点 | 结论 | 理由 |
|---|---|---|
| Word/Excel/PPT 怎么编辑？ | OnlyOffice DS（Community Edition） | 唯一同时满足三件套真实编辑 + Windows 原生安装 + 免费不限人数的开源引擎 |
| 多人实时协同由谁负责？ | OnlyOffice DS 内置机制 | 引擎内建同 key 会话合并与光标同步，自研 OT/CRDT 既重复又有风险 |
| 是否自研 OT/CRDT？ | 否 | 原则 2/9：复用成熟机制，不做玩具实现 |
| WebSocket 是否需要？ | 需要，但只用于"存在感"（presence） | DS 协同走它自己的通道；我们的 Socket.IO 只负责"谁在线/谁在编辑哪个文件/昵称颜色"，不碰文档内容 |
| 文件保存由谁负责？ | 自研服务层 | DS 通过回调（status 2/6）把保存后的文件 URL 交给我们，服务层负责原子落盘 + 备份 |
| 是否需要 Docker？ | 否 | DS 有 Windows 安装包；Docker 会显著抬高普通用户门槛 |
| 是否需要公网？ | 否 | 全程 0.0.0.0 局域网 HTTP |
| 文件管理/上传/重命名/删除/新建 | 自研（参考 filebrowser 交互） | 轻量、可控、便于做路径安全（UUID 索引，天然免疫路径穿越） |
| 局域网地址/端口/防火墙引导 | 自研 | 各调研项目都没有针对 Windows 普通用户的这类引导，是本项目独有价值 |

**License 合规**：本项目自身代码 MIT；OnlyOffice DS 不随本项目分发，由用户单独安装（AGPL-3.0 对"独立进程通过 API 交互"的集成方式明确允许），集成实现参考了官方 Apache-2.0 示例。详见 `LICENSES-THIRD-PARTY.md`。

## 五、识别出的技术风险与对策

1. **DS 未安装/未启动** → 服务启动时自动探测（healthcheck，80/8080 等常见端口），前端明确提示安装步骤，文件管理功能不受影响。
2. **JWT 默认开启（7.2+）** → 自动尝试读取 `C:\Program Files\ONLYOFFICE\DocumentServer\config\local.json` 中的密钥；也可在 `config/config.json` 手动配置。
3. **document.key 生命周期**（同会话连续性 vs 保存后刷新）→ 采用"保存回调时若无在线编辑者则版本+1 更换 key"的策略，兼顾会话连续与缓存失效。
4. **保存竞态/文件损坏** → DS 回调文件先落 temp，校验大小与 OOXML 魔数（PK），备份上一版后再原子替换。
5. **中文文件名** → 上传通道做 UTF-8 修复 + 清洗，下载用 RFC 5987 `filename*` 头。
