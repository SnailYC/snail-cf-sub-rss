/**
 * Cloudflare Worker — 订阅节点模板展开服务
 *
 * KV 存储（必须绑定，修改后即时生效无需重新部署）:
 *   绑定名: CONFIG_KV
 *   KV 中的 key:
 *     TOKEN      — 访问令牌，未设置时默认 'auto'
 *     SUB_CONFIG — JSON 格式的节点配置，结构如下:
 *       {
 *         "servers": [
 *           { "id": "server_0", "name": "服务器名称", "ip": "1.2.3.4" }
 *         ],
 *         "subs": [
 *           {
 *             "tag": "订阅标签",
 *             "template": "ss://...@{{IP}}:{{PORT}}?#{{NAME}}",
 *             "routes": [
 *               { "server": "server_0", "name": "线路名称", "port": "1234" }
 *             ]
 *           }
 *         ]
 *       }
 *
 * 占位符:
 *   {{IP}}   — 节点 IP，IPv6 地址自动包裹 []
 *   {{PORT}} — 端口号
 *   {{NAME}} — 节点名称，自动 URL 编码
 *
 * 访问方式:
 *   /?token=<TOKEN>        — 返回 base64 编码的订阅内容（默认）
 *   /?token=<TOKEN>&raw=1  — 返回原始多行文本
 *
 * 管理 API（需要 TOKEN 鉴权）:
 *   PUT /admin/config?token=<TOKEN>  — 更新配置到 KV
 *     Body: { "TOKEN": "...", "SUB_CONFIG": { ... } }
 *   GET /admin/config?token=<TOKEN>  — 查看 KV 中的当前配置
 */

let myToken = 'auto';
let timestamp = 4102329600000;
let total = 99 * 1125899906842624;
let download = Math.floor(Math.random() * 1099511627776);
let upload = download;

async function getConfig(env) {
    const kvToken = await env.CONFIG_KV.get('TOKEN');
    const kvSubConfig = await env.CONFIG_KV.get('SUB_CONFIG');

    return {
        token: kvToken || myToken,
        subConfig: kvSubConfig || '{"subs":[]}',
    };
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const token = url.searchParams.get('token');

        if (!env.CONFIG_KV) {
            return new Response('CONFIG_KV binding not configured', { status: 500 });
        }

        const config = await getConfig(env);
        myToken = config.token;

        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);
        const timeTemp = Math.ceil(currentDate.getTime() / 1000);
        const fakeToken = await MD5MD5(`${myToken}${timeTemp}`);

        if (url.pathname.startsWith('/admin/')) {
            return handleAdmin(request, env, url, token, fakeToken, config);
        }

        if (!isValidToken(token, fakeToken, url.pathname)) {
            return new Response(await nginx(), {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=UTF-8' },
            });
        }

        const result = expandTemplates(config.subConfig);

        download = Math.floor(((timestamp - Date.now()) / timestamp * total * 1099511627776) / 2);
        total *= 1099511627776;
        const expire = Math.floor(timestamp / 1000);

        const isRaw = url.searchParams.get('raw') === '1';
        const responseBody = isRaw ? result : base64EncodeUnicode(result);

        return new Response(responseBody, {
            headers: {
                "content-type": "text/plain; charset=utf-8",
                "Profile-Update-Interval": "6",
                "Subscription-Userinfo": `upload=${upload}; download=${download}; total=${total}; expire=${expire}`,
            },
        });
    }
};

async function handleAdmin(request, env, url, token, fakeToken, config) {
    if (!isValidToken(token, fakeToken, url.pathname)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (url.pathname === '/admin/config' && request.method === 'GET') {
        return jsonResponse({
            TOKEN: config.token,
            SUB_CONFIG: JSON.parse(config.subConfig),
        });
    }

    if (url.pathname === '/admin/config' && request.method === 'PUT') {
        const body = await request.json();

        if (body.TOKEN !== undefined) {
            await env.CONFIG_KV.put('TOKEN', body.TOKEN);
        }
        if (body.SUB_CONFIG !== undefined) {
            const subConfigStr = typeof body.SUB_CONFIG === 'string'
                ? body.SUB_CONFIG
                : JSON.stringify(body.SUB_CONFIG);
            await env.CONFIG_KV.put('SUB_CONFIG', subConfigStr);
        }

        const updated = await getConfig(env);
        return jsonResponse({
            message: 'Config updated',
            TOKEN: updated.token,
            SUB_CONFIG: JSON.parse(updated.subConfig),
        });
    }

    return jsonResponse({ error: 'Not found' }, 404);
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

function expandTemplates(subConfigJson) {
    const config = JSON.parse(subConfigJson);
    const serverMap = {};
    for (const s of config.servers || []) {
        serverMap[s.id] = s;
    }

    const lines = [];
    for (const sub of config.subs || []) {
        const { tag, template, routes } = sub;
        for (const route of routes || []) {
            const server = serverMap[route.server];
            if (!server) continue;
            const ip = server.ip.includes(':') ? `[${server.ip}]` : server.ip;
            const name = `${tag}-${route.name}`;
            const line = template
                .replaceAll('{{IP}}', ip)
                .replaceAll('{{PORT}}', route.port)
                .replaceAll('{{NAME}}', encodeURIComponent(name));
            lines.push(line);
        }
    }

    return lines.join('\n');
}

function isValidToken(token, fakeToken, pathname) {
    return token === myToken || token === fakeToken || pathname === `/${myToken}` || pathname.includes(`/${myToken}?`);
}

function base64EncodeUnicode(str) {
    const utf8Bytes = new TextEncoder().encode(str);
    return btoa(String.fromCharCode(...utf8Bytes));
}

async function MD5MD5(text) {
    const encoder = new TextEncoder();

    const firstPass = await crypto.subtle.digest('MD5', encoder.encode(text));
    const firstPassArray = Array.from(new Uint8Array(firstPass));
    const firstHex = firstPassArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const secondPass = await crypto.subtle.digest('MD5', encoder.encode(firstHex.slice(7, 27)));
    const secondPassArray = Array.from(new Uint8Array(secondPass));
    const secondHex = secondPassArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return secondHex.toLowerCase();
}

async function nginx() {
    const text = `
	<!DOCTYPE html>
	<html>
	<head>
	<title>Welcome to nginx!</title>
	<style>
		body {
			width: 35em;
			margin: 0 auto;
			font-family: Tahoma, Verdana, Arial, sans-serif;
		}
	</style>
	</head>
	<body>
	<h1>Welcome to nginx!</h1>
	<p>If you see this page, the nginx web server is successfully installed and
	working. Further configuration is required.</p>
	
	<p>For online documentation and support please refer to
	<a href="http://nginx.org/">nginx.org</a>.<br/>
	Commercial support is available at
	<a href="http://nginx.com/">nginx.com</a>.</p>
	
	<p><em>Thank you for using nginx.</em></p>
	</body>
	</html>
	`
    return text;
}
