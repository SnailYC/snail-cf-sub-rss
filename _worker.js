/**
 * Cloudflare Worker — 订阅节点模板展开服务
 *
 * KV 绑定（修改后即时生效无需重新部署）:
 *
 *   SERVERS_KV — 服务器列表（多个部署可共享同一个 KV 命名空间）
 *     key: SERVERS — JSON 数组:
 *       [{ "id": "server_0", "name": "服务器名称", "host": "1.2.3.4", "hostv6": "2001:db8::1" }]
 *       host 和 hostv6 至少填一个；同时存在时展开为两个节点（hostv6 节点名后缀 -ipv6）
 *
 *   CONFIG_KV — 部署独立配置（每个部署绑定各自的 KV 命名空间）
 *     key: TOKEN   — 访问令牌，未设置时默认 'auto'
 *     key: PROXIES — JSON 数组:
 *       [{
 *         "tag": "订阅标签",
 *         "template": "ss://...@{{IP}}:{{PORT}}?#{{NAME}}",
 *         "routes": [{ "serverId": "server_0", "name": "线路名称", "port": "1234" }]
 *       }]
 *
 * 占位符:
 *   {{IP}}   — 服务器地址，IPv6 自动包裹 []
 *   {{PORT}} — 端口号
 *   {{NAME}} — 自动生成为 tag-route.name，URL 编码
 *
 * 访问方式:
 *   /?token=<TOKEN>        — 返回 base64 编码的订阅内容（默认）
 *   /?token=<TOKEN>&raw=1  — 返回原始多行文本
 *
 * 管理 API（需要 TOKEN 鉴权）:
 *   GET  /admin/servers?token=<TOKEN>  — 查看服务器列表
 *   PUT  /admin/servers?token=<TOKEN>  — 更新服务器列表
 *   GET  /admin/proxies?token=<TOKEN>  — 查看代理配置
 *   PUT  /admin/proxies?token=<TOKEN>  — 更新代理配置
 *   GET  /admin/config?token=<TOKEN>   — 查看完整配置（含 TOKEN）
 *   PUT  /admin/config?token=<TOKEN>   — 更新 TOKEN
 */

let myToken = 'auto';
let timestamp = 4102329600000;
let total = 99 * 1125899906842624;
let download = Math.floor(Math.random() * 1099511627776);
let upload = download;

async function getConfig(env) {
    const [kvToken, kvProxies, kvServers] = await Promise.all([
        env.CONFIG_KV.get('TOKEN'),
        env.CONFIG_KV.get('PROXIES'),
        env.SERVERS_KV ? env.SERVERS_KV.get('SERVERS') : null,
    ]);

    return {
        token: kvToken || myToken,
        servers: kvServers || '[]',
        proxies: kvProxies || '[]',
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

        const result = expandTemplates(config.servers, config.proxies);

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

    const { pathname } = url;
    const { method } = request;

    if (pathname === '/admin/servers' && method === 'GET') {
        return jsonResponse(JSON.parse(config.servers));
    }

    if (pathname === '/admin/servers' && method === 'PUT') {
        if (!env.SERVERS_KV) {
            return jsonResponse({ error: 'SERVERS_KV binding not configured' }, 500);
        }
        const body = await request.json();
        const str = typeof body === 'string' ? body : JSON.stringify(body);
        await env.SERVERS_KV.put('SERVERS', str);
        return jsonResponse({ message: 'Servers updated', servers: JSON.parse(str) });
    }

    if (pathname === '/admin/proxies' && method === 'GET') {
        return jsonResponse(JSON.parse(config.proxies));
    }

    if (pathname === '/admin/proxies' && method === 'PUT') {
        const body = await request.json();
        const str = typeof body === 'string' ? body : JSON.stringify(body);
        await env.CONFIG_KV.put('PROXIES', str);
        return jsonResponse({ message: 'Proxies updated', proxies: JSON.parse(str) });
    }

    if (pathname === '/admin/config' && method === 'GET') {
        return jsonResponse({
            TOKEN: config.token,
            servers: JSON.parse(config.servers),
            proxies: JSON.parse(config.proxies),
        });
    }

    if (pathname === '/admin/config' && method === 'PUT') {
        const body = await request.json();
        if (body.TOKEN !== undefined) {
            await env.CONFIG_KV.put('TOKEN', body.TOKEN);
        }
        const updated = await getConfig(env);
        return jsonResponse({
            message: 'Config updated',
            TOKEN: updated.token,
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

function wrapIPv6(addr) {
    return addr.includes(':') ? `[${addr}]` : addr;
}

function expandTemplates(serversJson, proxiesJson) {
    const servers = JSON.parse(serversJson);
    const proxies = JSON.parse(proxiesJson);

    const serverMap = {};
    for (const s of servers) {
        serverMap[s.id] = s;
    }

    const lines = [];
    for (const proxy of proxies) {
        const { tag, template, routes } = proxy;
        for (const route of routes || []) {
            const server = serverMap[route.serverId];
            if (!server) continue;

            if (server.host) {
                const name = `${tag}-${route.name}`;
                lines.push(template
                    .replaceAll('{{IP}}', wrapIPv6(server.host))
                    .replaceAll('{{PORT}}', route.port)
                    .replaceAll('{{NAME}}', encodeURIComponent(name)));
            }

            if (server.hostv6) {
                const name = `${tag}-${route.name}-ipv6`;
                lines.push(template
                    .replaceAll('{{IP}}', wrapIPv6(server.hostv6))
                    .replaceAll('{{PORT}}', route.port)
                    .replaceAll('{{NAME}}', encodeURIComponent(name)));
            }
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
