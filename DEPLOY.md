# 部署指南（纯 Cloudflare Dashboard 操作）

> 全程在浏览器内完成，不需要安装任何 CLI 工具，不需要本地运行任何命令。

---

## 步骤 1：把代码放到 GitHub 上

1. 打开 [github.com](https://github.com)，登录账号
2. 点击右上角 **+** → **New repository**
3. 仓库名填写 `openrouter-workers-proxy`
4. 选择 **Public** 或 **Private** 均可，点击 **Create repository**
5. 在仓库页面点击 **Add file** → **Upload files**
6. 把本项目的全部文件（src/、public/、types/、package.json、tsconfig.json、wrangler.toml）打包成 ZIP 上传，或使用 GitHub 网页逐个上传

> 如果你已有代码在本地，也可以直接把整个项目文件夹拖进 GitHub 网页的上传区域。

---

## 步骤 2：在 Cloudflare 创建 Worker 并关联 GitHub

1. 打开 [dash.cloudflare.com](https://dash.cloudflare.com)，登录账号
2. 左侧菜单 → **Workers & Pages** → **Create application**
3. 选择 **Connect to Git**
4. 首次使用需授权 Cloudflare 访问你的 GitHub 账号，按提示完成授权
5. 选择刚才创建的仓库 `openrouter-workers-proxy`
6. 框架选择 **None / Other**
7. 构建命令留空，输出目录留空
8. 点击 **Save and Deploy**

> 首次部署会报错（提示缺少 D1/KV 绑定），这是正常的，后续配置完成后重新部署即可。

---

## 步骤 3：在 Dashboard 创建 D1 数据库

1. 左侧菜单 → **D1** → **Create database**
2. 名称填写 `openrouter_proxy` → 点击 **Create**
3. 创建成功后，记下页面显示的数据库 ID（一串 UUID），后续绑定会用到

---

## 步骤 4：在 Dashboard 创建 KV 命名空间

1. 左侧菜单 → **KV** → **Create namespace**
2. 名称填写 `CACHE` → 点击 **Create**

---

## 步骤 5：在 Worker 设置中绑定 D1 和 KV

1. 左侧菜单 → **Workers & Pages** → 点击你的 Worker `openrouter-workers-proxy`
2. 点击顶部 **Settings** 标签
3. 左侧 → **Bindings** → **Add**
4. 选择 **D1 database**，填写：
   - Variable name: `DB`
   - Database: 选择刚才创建的 `openrouter_proxy`
5. 再次点击 **Add** → 选择 **KV namespace**，填写：
   - Variable name: `CACHE`
   - Namespace: 选择刚才创建的 `CACHE`
6. 点击 **Save**

---

## 步骤 6：设置环境变量与 Secrets

1. 在 Worker 页面，点击 **Settings** → **Variables**
2. 点击 **Edit variables**
3. 在 **Environment Variables** 区域添加以下变量（点击下方 **+ Add variable**）：

| Variable name | Value |
|---|---|
| `SESSION_COOKIE_NAME` | `wb_admin_session` |
| `CSRF_COOKIE_NAME` | `wb_admin_csrf` |
| `UPSTREAM_BASE_URL` | `https://openrouter.ai/api` |
| `ADMIN_SESSION_TTL_SECONDS` | `28800` |
| `DEFAULT_TOKEN_RPM` | `60` |
| `DEFAULT_TOKEN_DAILY_LIMIT` | `10000` |

4. 在 **Secrets** 区域（页面下方或点击 **Encrypt**）添加以下加密变量：

| Secret name | 填写说明 |
|---|---|
| `ADMIN_BOOTSTRAP_TOKEN` | 输入 64 位以上随机字符串，妥善保存，这是登录后台的密码 |
| `SESSION_SIGNING_SECRET` | 输入 32 位以上随机字符串，用于签名管理员会话 |
| `KEY_ENCRYPTION_SECRET` | 输入 32 位以上随机字符串，用于加密上游 OpenRouter Key |

> 生成随机字符串的方法：打开任意在线密码生成器（如 `passwordsgenerator.net`），选择长度 64，生成后复制粘贴。

5. 点击 **Save**

---

## 步骤 7：执行数据库迁移（建表）

1. 左侧菜单 → **D1** → 点击数据库 `openrouter_proxy`
2. 点击 **Console** 标签
3. 打开本项目文件 `src/db/migrations/0001_init.sql`，复制全部 SQL 内容
4. 粘贴到 D1 Console 的输入框中，点击 **Execute**
5. 看到 "Success" 表示建表完成

---

## 步骤 8：重新部署 Worker

1. 回到 Worker 页面，点击顶部 **Deployments** 标签
2. 点击 **Retry deployment** 或等待 Git 推送触发自动重新部署
3. 也可以手动点击 **Deploy** 按钮重新部署

> 重新部署后，D1、KV 和 Secrets 的绑定会生效。

---

## 步骤 9：验证与首次配置

### 9.1 验证服务是否运行

在浏览器中访问：

```
https://openrouter-workers-proxy.<你的账号>.workers.dev/api/healthz
```

（将域名替换为你在 Dashboard 看到的实际 Worker 域名）

预期看到 JSON 返回 `{"success": true}`。

### 9.2 登录管理后台

1. 打开浏览器访问：`https://<你的域名>/admin/`
2. 在登录页面输入步骤 6 中设置的 `ADMIN_BOOTSTRAP_TOKEN`
3. 登录成功后进入后台

### 9.3 添加上游 OpenRouter Key

1. 在后台点击 **上游 Key 池**
2. 填写：
   - Key 标签：例如 `主账号`
   - OpenRouter Key：你的 `sk-or-v1-...` 密钥
   - 权重：`1`
3. 点击 **添加上游 Key**

> Key 写入后立即被 AES-GCM 加密，不会在前端再次显示明文。

### 9.4 创建服务 Token（给客户端使用）

1. 在后台点击 **服务 Token 管理**
2. 填写：
   - 显示名称：例如 `生产环境 Web`
   - 应用名称：例如 `my-app`
   - 应用地址：`https://app.example.com`
   - 每分钟限流：`60`
   - 日请求上限：`10000`
3. 点击 **创建服务 Token**
4. **立即复制并保存弹出的 Token 明文**，平台不会再显示

### 9.5 客户端调用示例

```bash
curl -X POST https://<你的域名>/v1/chat/completions \
  -H "Authorization: Bearer <你保存的 plainToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

---

## 安全注意事项

- **ADMIN_BOOTSTRAP_TOKEN** 是后台的唯一入口密码，一旦泄露任何人都能登录。建议只在初始化时使用，用完后可以在 Dashboard Variables 中修改轮换。
- **SESSION_SIGNING_SECRET** 和 **KEY_ENCRYPTION_SECRET** 只保存在 Cloudflare 的加密变量中，不会出现在代码或日志里。
- 管理员会话 Cookie 为 `HttpOnly; Secure; SameSite=Strict`，仅通过 HTTPS 传输。
- 所有管理后台的写操作（创建、修改、停用）都需要 CSRF Token 校验。
- 上游 OpenRouter 地址在代码中固定为 `https://openrouter.ai/api`，无法被客户端参数篡改，防止 SSRF。
- 客户端的地区/IP 等信息在转发过程中被清洗，不会透传到 OpenRouter。

---

## 常见问题排查

| 现象 | 排查方向 |
|---|---|
| 部署失败提示缺少 D1/KV 绑定 | 检查步骤 5 的 Bindings 是否已保存并重新部署 |
| 访问 `/admin/` 返回 404 | 检查 `public/admin/index.html` 是否已上传到 GitHub 并重新部署 |
| 登录返回 `401` | 检查 `ADMIN_BOOTSTRAP_TOKEN` 是否在 Dashboard Variables 中已设置，输入是否正确 |
| 管理写操作返回 `403` | 检查请求是否携带了正确的 CSRF Token（从登录响应获取） |
| 代理返回 `503` | 检查是否已添加至少一个状态为 `active` 的上游 OpenRouter Key |
| 代理返回 `429` | 检查服务 Token 的 RPM/日配额限制，或当前 IP 是否触发限流 |

---

祝你部署顺利！
