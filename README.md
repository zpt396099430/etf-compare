# ETF 申购赎回清单对比工具

上传文件A（XML格式），自动从国泰基金网站获取对应数据，三方对比高亮差异。

## 功能
- 解析上传的 XML 申购赎回清单（文件A）
- 自动下载国泰基金网站 XML 文件（数据源B）
- 自动调用国泰基金 API 获取数据（数据源C）
- 三方数据存入 SQLite 数据库
- 高亮展示 A vs B、A vs C 的差异项

## 使用方式

### 方式一：直接运行 exe（Windows）
下载 Release 中的 `etf-compare.exe`，双击运行，自动打开浏览器。

### 方式二：源码运行
```bash
npm install
npm start
```
然后访问 http://localhost:3333

## 技术栈
- Node.js + Express
- SQLite (better-sqlite3)
- Vue 3 + Element Plus
