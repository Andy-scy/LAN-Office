# 第三方组件与许可声明（THIRD-PARTY NOTICES）

本项目（LAN Office）自身代码以 MIT 协议发布。项目运行依赖或集成了以下第三方组件，
各自归其作者所有，本项目按其许可证要求使用并在下表注明。

## 运行时集成

| 组件 | 作者 / 地址 | 许可证 | 集成方式 |
|---|---|---|---|
| ONLYOFFICE Docs / Document Server（Community Edition） | ONLYOFFICE — https://github.com/ONLYOFFICE/DocumentServer | AGPL-3.0 | 不随本项目分发；由用户在服务器上独立安装，经 HTTP API / JS API 集成 |
| document-server-integration（官方集成示例） | ONLYOFFICE — https://github.com/ONLYOFFICE/document-server-integration | Apache-2.0 | 未复制代码；参考其回调保存（status 2/3/6/7）、forcesave 命令、document.key 版本管理与"保存前版本目录"设计模式 |

## npm 依赖（随 package.json 分发）

| 包 | 许可证 | 用途 |
|---|---|---|
| express | MIT | HTTP 服务框架 |
| socket.io | MIT | WebSocket（在线状态 presence） |
| multer | MIT | 文件上传 |
| jsonwebtoken | MIT | OnlyOffice JWT 签名/校验 |
| jszip（devDependencies） | MIT | 生成空白 Office 模板的备用脚本 |
| socket.io-client（devDependencies） | MIT | 集成测试 |

## 随项目分发的模板文件

`server/templates/blank.docx / blank.xlsx / blank.pptx` 由本项目的
`scripts/make-templates.py` 使用 python-docx / openpyxl / python-pptx 生成
（这三者为构建期工具，BSD / MIT 许可，不随项目分发），模板文件本身仅含空的
OOXML 结构，无第三方版权内容。

## 说明

- ONLYOFFICE Document Server 为独立的进程/服务，其源码与完整许可文本见其官方仓库。
  AGPL-3.0 允许通过进程边界（HTTP API）与之集成；如对其源码做出修改并对外提供服务，
  需遵循 AGPL-3.0 开源相应修改。
- 以上清单如有遗漏，以各组件官方仓库的 LICENSE 文件为准。
