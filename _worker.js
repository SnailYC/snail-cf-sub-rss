/**
 * Cloudflare Worker — 订阅节点模板展开服务
 *
 * 环境变量:
 *   TOKEN      — 访问令牌（必填）
 *   SUB_CONFIG — JSON 格式的节点配置，结构如下:
 *     {
 *       "subs": [
 *         {
 *           "template": "ss://...@{{IP}}:{{PORT}}?#{{NAME}}",
 *           "nodes": [
 *             { "name": "节点名称", "ip": "1.2.3.4", "port": "1234" }
 *           ]
 *         }
 *       ]
 *     }
 *
 * 占位符:
 *   {{IP}}   — 节点 IP，IPv6 地址自动包裹 []
 *   {{PORT}} — 端口号
 *   {{NAME}} — 节点名称，自动 URL 编码
 *
 * 访问方式:
 *   /?token=<TOKEN>        — 返回 base64 编码的订阅内容（默认）
 *   /?token=<TOKEN>&raw=1  — 返回原始多行文本
 */

let myToken = 'auto';
let timestamp = 4102329600000;
let total = 99 * 1125899906842624;
let download = Math.floor(Math.random() * 1099511627776);
let upload = download;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const token = url.searchParams.get('token');

        myToken = env.TOKEN || myToken;

        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);
        const timeTemp = Math.ceil(currentDate.getTime() / 1000);
        const fakeToken = await MD5MD5(`${myToken}${timeTemp}`);

        if (!isValidToken(token, fakeToken, url.pathname)) {
            return new Response(await nginx(), {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=UTF-8' },
            });
        }

        const subConfigJson = env.SUB_CONFIG || '{"subs":[]}';
        const result = expandTemplates(subConfigJson);

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

function expandTemplates(subConfigJson) {
    const config = JSON.parse(subConfigJson);
    const lines = [];

    for (const sub of config.subs || []) {
        const { template, nodes } = sub;
        for (const node of nodes || []) {
            const ip = node.ip.includes(':') ? `[${node.ip}]` : node.ip;
            const line = template
                .replaceAll('{{IP}}', ip)
                .replaceAll('{{PORT}}', node.port)
                .replaceAll('{{NAME}}', encodeURIComponent(node.name));
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
