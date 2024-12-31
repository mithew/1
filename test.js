
// 请求频率限制配置
const RATE_LIMIT_WINDOW = 120000; // 时间窗口限制：2分钟（单位：毫秒）
const RATE_LIMIT_MAX_REQUESTS = 20; // 在时间窗口内允许的最大请求数量

// 初始化常量
const github_repo = typeof(GITHUB_REPO) != "undefined" ? GITHUB_REPO : 'mithew/url-duan'; // GitHub 仓库地址，默认值为 'mithew/url-duan'
const github_version = typeof(GITHUB_VERSION) != "undefined" ? GITHUB_VERSION : '@main'; // GitHub 版本，默认值为 '@main'
const password = typeof(PASSWORD) != "undefined" ? PASSWORD : 'AoEiuV020 yes'; // 管理员密码，默认值为 'AoEiuV020 yes'
const shorten_timeout = typeof(SHORTEN_TIMEOUT) != "undefined" ? SHORTEN_TIMEOUT.split("*").reduce((a, b) => parseInt(a) * parseInt(b), 1) : (1000 * 1 * 1); // 短链接过期时间，默认值为 1000 毫秒（1 秒）
const default_len = typeof(DEFAULT_LEN) != "undefined" ? parseInt(DEFAULT_LEN) : 4; // 默认短链接长度，默认值为 4
const demo_mode = typeof(DEMO_MODE) != "undefined" ? DEMO_MODE === 'true' : false; // 是否启用演示模式，默认值为 false
const remove_completely = typeof(REMOVE_COMPLETELY) != "undefined" ? REMOVE_COMPLETELY === 'true' : true; // 是否完全移除过期的短链接，默认值为 true
const white_list = JSON.parse(typeof(WHITE_LIST) != "undefined" ? WHITE_LIST : `["020.name"]`); // 白名单域名列表，默认值为 ["020.name"]
const demo_notice = typeof(DEMO_NOTICE) != "undefined" ? DEMO_NOTICE : ` `; // 演示模式下的通知信息，默认值为空字符串

const html404 = `
404 Not Found.
The url you visit is not found.
`;

// 内存缓存
const cache = new Map();
const requestCounts = new Map();

// 生成随机字符串
async function randomString(len) {
    let $chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
    let maxPos = $chars.length;
    let result = '';
    for (let i = 0; i < len; i++) {
        result += $chars.charAt(Math.floor(Math.random() * maxPos));
    }
    return result;
}

// 检查白名单
async function checkWhite(host) {
    return white_list.some((h) => host == h || host.endsWith('.' + h));
}

// MD5加密
async function md5(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('MD5', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// 检查哈希值
async function checkHash(url, hash) {
    if (!hash) {
        return false;
    }
    return (await md5(url + password)) == hash;
}

// 保存URL
async function save_url(url, key, admin, len) {
    len = len || default_len;
    const override = admin && key;
    if (!override) {
        key = await randomString(len);
    }
    const is_exists = await load_url(key);
    console.log("key exists " + key + " " + is_exists);
    if (override || !is_exists) {
        var mode = 3;
        if (admin) {
            mode = 0;
        }
        let value = `${mode};${Date.now()};${url}`;
        if (remove_completely && mode != 0 && !await checkWhite(new URL(url).host)) {
            let ttl = Math.max(60, shorten_timeout / 1000);
            console.log("key auto remove: " + key + ", " + ttl + "s");
            return await LINKS.put(key, value, { expirationTtl: ttl }), key;
        } else {
            return await LINKS.put(key, value), key;
        }
    } else {
        return await save_url(url, key, admin, len + 1);
    }
}

// 加载URL
async function load_url(key) {
    if (cache.has(key)) {
        return cache.get(key);
    }
    const value = await LINKS.get(key);
    if (!value) {
        return null;
    }
    const list = value.split(';');
    console.log("value split " + list);
    var url;
    if (list.length == 1) {
        url = list[0];
    } else {
        url = list[2];
        const mode = parseInt(list[0]);
        const create_time = parseInt(list[1]);
        if (mode != 0 && shorten_timeout > 0 && Date.now() - create_time > shorten_timeout) {
            const host = new URL(url).host;
            if (await checkWhite(host)) {
                console.log('white list');
            } else {
                console.log("shorten timeout");
                return null;
            }
        }
    }
    cache.set(key, url);
    setTimeout(() => cache.delete(key), 60000); // 缓存1分钟
    return url;
}

// 检查请求频率
function checkRequestRate(ip) {
    const now = Date.now();
    const requests = requestCounts.get(ip) || [];
    const recentRequests = requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
    if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
        return false;
    }
    requestCounts.set(ip, [...recentRequests, now]);
    return true;
}

// 处理请求
async function handleRequest(request) {
    const ip = request.headers.get('cf-connecting-ip');
    if (!checkRequestRate(ip)) {
        return new Response(`{"status":429,"message":"Too many requests"}`, {
            headers: {
                "content-type": "text/html;charset=UTF-8",
            },
            status: 429
        });
    }

    if (request.method === "POST") {
        let req = await request.json();
        console.log("url " + req["url"]);
        let admin = await checkHash(req["url"], req["hash"]);
        console.log("admin " + admin);
        if (!admin && req["hash"]) {
            return new Response(`{"status":401,"message":"Incorrect password"}`, {
                headers: {
                    "content-type": "text/html;charset=UTF-8",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST",
                },
            });
        }
        if (!demo_mode && !await checkWhite(new URL(req["url"]).host)) {
            return new Response(`{"status":500,"key":": Error: Url not allowed."}`, {
                headers: {
                    "content-type": "text/html;charset=UTF-8",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST",
                },
            });
        }
        let stat, random_key = await save_url(req["url"], req["key"], admin);
        console.log("stat " + stat);
        if (typeof (stat) == "undefined") {
            return new Response(`{"status":200,"key":"/` + random_key + `"}`, {
                headers: {
                    "content-type": "text/html;charset=UTF-8",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST",
                },
            });
        } else {
            return new Response(`{"status":200,"key":": Error:Reach the KV write limitation."}`, {
                headers: {
                    "content-type": "text/html;charset=UTF-8",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST",
                },
            });
        }
    } else if (request.method === "OPTIONS") {
        return new Response(``, {
            headers: {
                "content-type": "text/html;charset=UTF-8",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST",
            },
        });
    }

    const requestURL = new URL(request.url);
    const path = requestURL.pathname.split("/")[1];
    console.log(path);
    if (!path) {
        const html = await fetch(`https://dv.neee.win/dv/cdn.jsdelivr.net/gh/${github_repo}${github_version}/index.html`);
        const text = (await html.text())
            .replaceAll("###GITHUB_REPO###", github_repo)
            .replaceAll("###GITHUB_VERSION###", github_version)
            .replaceAll("###DEMO_NOTICE###", demo_notice);

        return new Response(text, {
            headers: {
                "content-type": "text/html;charset=UTF-8",
            },
        });
    }
    const url = await load_url(path);
    if (!url) {
        console.log('not found');
        return new Response(html404, {
            headers: {
                "content-type": "text/html;charset=UTF-8",
            },
            status: 404
        });
    }
    return Response.redirect(url, 302);
}

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
