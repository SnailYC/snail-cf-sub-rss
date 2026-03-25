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

所有配置通过 KV 存储，**修改后即时生效**，无需重新部署。

### 配置步骤

1. 在 Cloudflare 控制台创建一个 KV 命名空间（例如 `CONFIG_KV`）。
2. 在 Pages / Workers 的设置中，添加 KV 命名空间绑定：
   - **变量名称**: `CONFIG_KV`
   - **KV 命名空间**: 选择上一步创建的命名空间
3. 部署后，通过 Cloudflare 控制台或管理 API 写入配置即可使用。

### KV 中的 Key

| Key | 必填 | 说明 |
|-----|------|------|
| `TOKEN` | 否 | 访问令牌，未设置时默认为 `auto` |
| `SUB_CONFIG` | 否 | JSON 格式的节点配置，详见下方说明 |

你可以在 Cloudflare 控制台直接编辑 KV 值，也可以使用下方的管理 API。

## 管理 API

通过 HTTP 请求直接更新 KV 中的配置（需要 TOKEN 鉴权）。

### 查看当前配置

```
GET /admin/config?token=<TOKEN>
```

### 更新配置

```
PUT /admin/config?token=<TOKEN>
Content-Type: application/json

{
  "TOKEN": "new-token",
  "SUB_CONFIG": {
    "subs": [...]
  }
}
```

可以只更新其中一个字段，例如只更新 `SUB_CONFIG`：

```
PUT /admin/config?token=<TOKEN>
Content-Type: application/json

{
  "SUB_CONFIG": {
    "subs": [
      {
        "template": "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@{{IP}}:{{PORT}}?#{{NAME}}",
        "nodes": [
          { "name": "节点1", "ip": "1.2.3.4", "port": "8080" }
        ]
      }
    ]
  }
}
```

## SUB_CONFIG 配置说明

`SUB_CONFIG` 是一个 JSON 字符串，包含一个 `subs` 数组，每个元素由 `template`（模板）和 `nodes`（节点列表）组成。

### 占位符

在 `template` 中使用以下占位符，展开时自动替换：

| 占位符 | 说明 |
|--------|------|
| `{{IP}}` | 节点 IP 地址。IPv6 地址自动包裹 `[]` |
| `{{PORT}}` | 节点端口 |
| `{{NAME}}` | 节点名称，自动进行 URL 编码 |

### 配置示例

```json
{
  "subs": [
    {
      "template": "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@{{IP}}:{{PORT}}?#{{NAME}}",
      "nodes": [
        { "name": "地址 1-1", "ip": "1.2.3.4", "port": "39623" },
        { "name": "地址 1-2", "ip": "1.2.3.4", "port": "39621" }
      ]
    },
    {
      "template": "vless://uuid@{{IP}}:{{PORT}}?encryption=none&security=reality&sni=yahoo.com&fp=chrome&type=xhttp#{{NAME}}",
      "nodes": [
        { "name": "地址 2-1", "ip": "example.com", "port": "35727" },
        { "name": "地址 2-2", "ip": "2409:8c54:1841:2008:0:1:0:1b5", "port": "15182" }
      ]
    }
  ]
}
```

上面的配置会展开为：

```
ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:39623?#%E5%9C%B0%E5%9D%80%201-1
ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:39621?#%E5%9C%B0%E5%9D%80%201-2
vless://uuid@example.com:35727?encryption=none&security=reality&sni=yahoo.com&fp=chrome&type=xhttp#%E5%9C%B0%E5%9D%80%202-1
vless://uuid@[2409:8c54:1841:2008:0:1:0:1b5]:15182?encryption=none&security=reality&sni=yahoo.com&fp=chrome&type=xhttp#%E5%9C%B0%E5%9D%80%202-2
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
