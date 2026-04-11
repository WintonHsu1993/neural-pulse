# NEURAL PULSE · AI 行业热点资讯

**完全免费 · 无需服务器 · 中国境内可访问 · 每日自动更新**

基于 GitHub Pages + GitHub Actions 的静态 AI 新闻聚合站。

---

## 架构说明

```
GitHub Actions (每天 08:30 北京时间)
    ↓ 抓取 9 个 RSS 源
    ↓ 热点评分排序
    ↓ 调用 Claude API 生成五段式分析
    ↓ 写入 data/*.json
    ↓ 自动 git push
GitHub Pages
    ↓ 自动发布静态网站
用户访问 https://你的用户名.github.io/neural-pulse
```

---

## 🚀 部署步骤（约 10 分钟）

### 第一步：Fork 或创建仓库

1. 登录 [github.com](https://github.com)
2. 点击右上角 **+** → **New repository**
3. 仓库名填：`neural-pulse`
4. 选 **Public**（GitHub Pages 免费版需要公开仓库）
5. 点击 **Create repository**

### 第二步：上传项目文件

将本项目所有文件上传到仓库根目录（可用 GitHub 网页拖拽上传，或用 git）：

```bash
git init
git remote add origin https://github.com/你的用户名/neural-pulse.git
git add .
git commit -m "🚀 Initial deploy"
git push -u origin main
```

文件结构应为：
```
neural-pulse/
├── index.html              ← 前端页面
├── data/
│   ├── daily.json          ← 今日热点（Actions 自动更新）
│   ├── weekly.json         ← 周榜（Actions 自动更新）
│   ├── search.json         ← 搜索索引
│   ├── stats.json          ← 统计数据
│   └── meta.json           ← 元信息
├── scripts/
│   ├── package.json
│   └── fetch-and-generate.js
└── .github/
    └── workflows/
        └── update-news.yml
```

### 第三步：开启 GitHub Pages

1. 进入仓库 → **Settings** → **Pages**
2. Source 选 **Deploy from a branch**
3. Branch 选 **main**，目录选 **/ (root)**
4. 点击 **Save**
5. 等约 1 分钟，访问：`https://你的用户名.github.io/neural-pulse`

### 第四步：设置 Anthropic API Key（用于 AI 内容生成）

1. 进入仓库 → **Settings** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**
3. Name 填：`ANTHROPIC_API_KEY`
4. Value 填：你的 Anthropic API Key（在 [console.anthropic.com](https://console.anthropic.com) 获取）
5. 点击 **Add secret**

> ⚠️ 如果不设置 API Key，Actions 仍会运行并抓取新闻，但不会生成 AI 五段式分析内容。

### 第五步：手动触发第一次更新

1. 进入仓库 → **Actions** 标签
2. 点击左侧 **AI 资讯自动更新**
3. 点击右侧 **Run workflow** → **Run workflow**
4. 等待约 3-5 分钟运行完成
5. 刷新网站，看到最新数据 ✅

---

## ⏰ 自动更新时间表

| 任务 | 时间 | 说明 |
|------|------|------|
| 每日热点 | 北京时间 08:30 | 抓取 RSS + AI 生成内容 |
| 每周榜单 | 随每日任务积累 | 自动取本周最高分 TOP 5 |

---

## 📊 数据文件说明

| 文件 | 说明 | 更新频率 |
|------|------|---------|
| `data/daily.json` | 今日 TOP 2 热点 + 五段式内容 | 每天 |
| `data/weekly.json` | 本周 TOP 5 榜单 | 每天积累 |
| `data/search.json` | 近 30 天文章搜索索引 | 每天 |
| `data/stats.json` | 分类与来源统计 | 每天 |
| `data/meta.json` | Actions 运行元信息 | 每天 |

---

## 🔧 RSS 订阅源

| 来源 | 类别 |
|------|------|
| MIT Technology Review | 研究 |
| The Verge AI | 行业 |
| TechCrunch AI | 创业 |
| VentureBeat AI | 行业 |
| Google AI Blog | 研究 |
| Anthropic Blog | 研究 |
| IEEE Spectrum | 研究 |
| Ars Technica | 技术 |
| Wired | 技术 |

---

## 💰 费用说明

| 项目 | 费用 |
|------|------|
| GitHub Pages | **免费** |
| GitHub Actions（每月 2000 分钟） | **免费**（每次运行约 3-5 分钟，每月用约 150 分钟）|
| Anthropic API | 约 $0.01-0.05/天（可选，不配置也能运行）|

---

## 🇨🇳 中国境内访问

`github.io` 域名在中国大陆**大部分地区可以直接访问**（不需要 VPN）。

如果访问不稳定，可以：
1. 在 Cloudflare Pages 额外部署一份（免费，有 CDN 加速）
2. 购买一个国内域名做 CNAME 指向

---

## 本地运行脚本

```bash
cd scripts
npm install

# 测试运行（不写入文件）
node fetch-and-generate.js --dry-run

# 正式运行（需设置环境变量）
ANTHROPIC_API_KEY=your_key node fetch-and-generate.js
```
