# cf-sub-rss

基于 Cloudflare Workers / Pages 的订阅节点模板展开服务。通过 JSON 配置模板和节点列表，自动展开生成订阅链接。

## 部署方式

### Pages 部署

1. Fork 本项目到你的 GitHub。
2. 在 Cloudflare Pages 控制台选择「连接到 Git」，选中本项目并开始设置。
3. 部署完成后，在「自定义域」选项卡中绑定你的域名。

### Workers 部署

1. 在 Cloudflare Workers 控制台创建新 Worker。
2. 将 `_worker.js` 的内容粘贴到 Worker 编辑器中。

## KV 存储配置

所有配置通过 KV 存储，**修改后即时生效**，无需重新部署。使用两个 KV 命名空间，服务器列表可跨部署共享，代理配置各部署独立。

### 配置步骤

1. 在 Cloudflare 控制台创建两个 KV 命名空间：
   - **服务器 KV**（例如 `SERVERS_KV`）— 存储服务器列表，多个部署可共享
   - **配置 KV**（例如 `CONFIG_KV`）— 存储 TOKEN 和代理配置，每个部署各自独立
2. 在每个 Pages / Workers 部署的设置中，添加 KV 命名空间绑定：
   - 变量名称 `SERVERS_KV` → 选择共享的服务器 KV 命名空间
   - 变量名称 `CONFIG_KV` → 选择该部署独立的配置 KV 命名空间
3. 部署后，通过 Cloudflare 控制台或管理 API 写入配置即可使用。

### KV 中的 Key

**SERVERS_KV**（共享）:

| Key | 说明 |
|-----|------|
| `SERVERS` | JSON 数组，服务器列表 |

**CONFIG_KV**（各部署独立）:

| Key | 说明 |
|-----|------|
| `TOKEN` | 访问令牌，未设置时默认为 `auto` |
| `PROXIES` | JSON 数组，代理配置列表 |

你可以在 Cloudflare 控制台直接编辑 KV 值，也可以使用下方的管理 API。

## 管理 API

通过 HTTP 请求管理 KV 中的配置（所有接口需要 TOKEN 鉴权）。

### 服务器管理

```
GET /admin/servers?token=<TOKEN>
```

```
PUT /admin/servers?token=<TOKEN>
Content-Type: application/json

[
  { "id": "server_0", "name": "香港节点 01", "host": "203.0.113.10", "hostv6": "2001:db8::1" },
  { "id": "server_1", "name": "香港节点 02", "host": "203.0.113.20" }
]
```

### 代理管理

```
GET /admin/proxies?token=<TOKEN>
```

```
PUT /admin/proxies?token=<TOKEN>
Content-Type: application/json

[
  {
    "tag": "套餐 A",
    "template": "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@{{IP}}:{{PORT}}?#{{NAME}}",
    "routes": [
      { "serverId": "server_0", "name": "线路 1", "port": "8388" }
    ]
  }
]
```

### 完整配置

```
GET /admin/config?token=<TOKEN>
```

更新 TOKEN:

```
PUT /admin/config?token=<TOKEN>
Content-Type: application/json

{ "TOKEN": "new-token" }
```

## 配置说明

配置分为 `servers`（服务器列表）和 `proxies`（代理列表）两部分，分别存储在不同的 KV 中。

### 结构

- **`servers`**（SERVERS_KV）— 集中定义服务器，通过 `id` 被 `routes` 引用，地址变更只需改一处，多个部署共享。`host` 和 `hostv6` 至少填一个，同时存在时每条线路展开为两个节点（`hostv6` 节点名后缀 `-ipv6`）
- **`proxies`**（CONFIG_KV）— 代理列表，各部署独立。每个代理由 `tag` 标识，可包含：
  - **`nodes`**（可选）— 完整节点 URI 数组，支持 `{{NAME}}` 占位符（自动替换为 `tag-直连节点-序号`），展开时排在 template 之前
  - **`template` + `routes`**（可选）— 模板模式，通过引用 servers 自动展开
  - 两者可同时存在于同一个代理对象中
- **`routes`** — 线路列表，每条线路通过 `serverId` 引用一个服务器并指定端口

### 占位符

在 `template` 中使用以下占位符，展开时自动替换：

| 占位符 | 说明 |
|--------|------|
| `{{IP}}` | 服务器地址（从 `servers` 中获取，IPv6 自动包裹 `[]`） |
| `{{PORT}}` | 线路端口（来自 `routes` 中的 `port`） |
| `{{NAME}}` | 自动生成，URL 编码。template 中为 `tag-route.name`；nodes 中为 `tag-直连节点-序号` |

### 配置示例

**SERVERS_KV** 中的 `SERVERS`（多个部署共享）:

```json
[
  { "id": "server_0", "name": "香港节点 01", "host": "203.0.113.10", "hostv6": "2001:db8::1" },
  { "id": "server_1", "name": "香港节点 02", "host": "203.0.113.20" }
]
```

**CONFIG_KV** 中的 `PROXIES`（各部署独立）:

```json
[
  {
    "tag": "套餐 A",
    "nodes": [
      "trojan://password@example.com:443?security=tls#{{NAME}}",
      "vless://uuid@example.com:8443?encryption=none#{{NAME}}"
    ],
    "template": "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@{{IP}}:{{PORT}}?#{{NAME}}",
    "routes": [
      { "serverId": "server_0", "name": "线路 1", "port": "8388" },
      { "serverId": "server_1", "name": "线路 2", "port": "8389" }
    ]
  }
]
```

上面的配置会展开为（`nodes` 先输出，然后是 `template` 展开的结果）：

```
trojan://password@example.com:443?security=tls#%E5%A5%97%E9%A4%90%20A-%E7%9B%B4%E8%BF%9E%E8%8A%82%E7%82%B9-1
vless://uuid@example.com:8443?encryption=none#%E5%A5%97%E9%A4%90%20A-%E7%9B%B4%E8%BF%9E%E8%8A%82%E7%82%B9-2
ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@203.0.113.10:8388?#%E5%A5%97%E9%A4%90%20A-%E7%BA%BF%E8%B7%AF%201
ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@[2001:db8::1]:8388?#%E5%A5%97%E9%A4%90%20A-%E7%BA%BF%E8%B7%AF%201-ipv6
ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@203.0.113.20:8389?#%E5%A5%97%E9%A4%90%20A-%E7%BA%BF%E8%B7%AF%202
```

## 访问方式

假设你的域名为 `sub.example.com`，TOKEN 为 `auto`：

| URL | 说明 |
|-----|------|
| `https://sub.example.com/auto` | 返回 base64 编码的订阅内容 |
| `https://sub.example.com/?token=auto` | 同上 |
| `https://sub.example.com/?token=auto&raw=1` | 返回原始多行文本（不编码） |

默认返回 base64 编码格式，兼容大多数代理客户端的订阅导入功能。

## 免责声明

1. 本项目仅供学习、研究和安全测试目的，请于下载后 24 小时内删除，不得用作任何商业用途。
2. 使用本程序须遵守部署服务器所在地区及用户所在国家的法律法规，由使用者自行承担一切后果。
3. 作者不对使用本项目可能引起的任何直接或间接损害负责。
