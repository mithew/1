// config.js - 配置模块
const CONFIG = {
    github_repo: typeof(GITHUB_REPO)!="undefined" ? GITHUB_REPO : 'mithew/url-duan',
    github_version: typeof(GITHUB_VERSION)!="undefined" ? GITHUB_VERSION : '@main',
    password: typeof(PASSWORD)!="undefined" ? PASSWORD : 'AoEiuV020 yes',
    shorten_timeout: typeof(SHORTEN_TIMEOUT)!="undefined" ? 
        SHORTEN_TIMEOUT.split("*").reduce((a,b)=>parseInt(a)*parseInt(b),1) : (1000 * 1 * 1),
    default_len: typeof(DEFAULT_LEN)!="undefined" ? parseInt(DEFAULT_LEN) : 4,
    demo_mode: typeof(DEMO_MODE)!="undefined" ? DEMO_MODE === 'true' : false,
    remove_completely: typeof(REMOVE_COMPLETELY)!="undefined" ? REMOVE_COMPLETELY === 'true' : true,
    white_list: JSON.parse(typeof(WHITE_LIST)!="undefined" ? WHITE_LIST : '["020.name"]'),
    demo_notice: typeof(DEMO_NOTICE)!="undefined" ? DEMO_NOTICE : ' ',
    cache_ttl: 1800, // 缓存时间
    rate_limit: {
        requests: 25,     // 每个时间窗口允许的请求数
        window: 120,       // 时间窗口（秒）
        cleanup: 120       // 清理间隔（秒）
    }
};

// utils.js - 工具函数模块
class Utils {
    static async randomString(len) {
        const chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
        let result = '';
        for (let i = 0; i < len; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    static async md5(message) {
        const msgUint8 = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('MD5', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    static async checkURL(url) {
        const urlRegex = /^http(s)?:\/\/(.*@)?([\w-]+\.)*[\w-]+([_\-.,~! *:#()\w\/?%&=]*)?$/;
        return urlRegex.test(url) && url.startsWith('h');
    }

    static async checkWhite(host) {
        return CONFIG.white_list.some((h) => host === h || host.endsWith('.' + h));
    }
}

// cache.js - 缓存管理模块
class CacheManager {
    static async get(key) {
        const cacheKey = `url-shortener:${key}`;
        const cache = caches.default;
        const cachedResponse = await cache.match(new Request(cacheKey));
        return cachedResponse ? await cachedResponse.text() : null;
    }

    static async set(key, value) {
        const cacheKey = `url-shortener:${key}`;
        const cache = caches.default;
        const response = new Response(value, {
            headers: {
                'Cache-Control': `public, max-age=${CONFIG.cache_ttl}`
            }
        });
        await cache.put(new Request(cacheKey), response);
    }

    static async delete(key) {
        const cacheKey = `url-shortener:${key}`;
        const cache = caches.default;
        await cache.delete(new Request(cacheKey));
    }
}

// rate-limiter.js - 基于内存的频率限制模块
class RateLimiter {
    static ipMap = new Map();
    static cleanupInterval = CONFIG.rate_limit.cleanup * 1000;
    static lastCleanup = Date.now();

    static async cleanup(event) {
        const now = Date.now();
        if (now - this.lastCleanup < this.cleanupInterval) {
            return;
        }

        event.waitUntil((async () => {
            try {
                const expiredTime = now - (CONFIG.rate_limit.window * 1000);
                for (const [ip, data] of this.ipMap) {
                    if (data.timestamp < expiredTime) {
                        this.ipMap.delete(ip);
                    }
                }
                this.lastCleanup = now;
                console.log(`Cleaned up rate limit cache at ${new Date(now).toISOString()}`);
            } catch (error) {
                console.error('Rate limit cleanup error:', error);
            }
        })());
    }

    static async checkLimit(request, event) {
        await this.cleanup(event);
        const ip = request.headers.get('CF-Connecting-IP');
        const now = Date.now();
        
        let ipData = this.ipMap.get(ip);
        if (!ipData) {
            ipData = { count: 1, timestamp: now };
            this.ipMap.set(ip, ipData);
            return true;
        }

        if (now - ipData.timestamp > CONFIG.rate_limit.window * 1000) {
            ipData.count = 1;
            ipData.timestamp = now;
            return true;
        }

        if (ipData.count >= CONFIG.rate_limit.requests) {
            return false;
        }

        ipData.count++;
        return true;
    }
}

// url-manager.js - URL管理模块
class UrlManager {
    static async save(url, key, admin, len = CONFIG.default_len) {
        const override = admin && key;
        if (!override) {
            key = await Utils.randomString(len);
        }

        const exists = await this.load(key);
        if (exists && !override) {
            return this.save(url, key, admin, len + 1);
        }

        const mode = admin ? 0 : 3;
        const value = `${mode};${Date.now()};${url}`;

        if (CONFIG.remove_completely && mode !== 0 && !await Utils.checkWhite(new URL(url).host)) {
            const ttl = Math.max(60, CONFIG.shorten_timeout / 1000);
            await LINKS.put(key, value, {expirationTtl: ttl});
        } else {
            await LINKS.put(key, value);
        }

        await CacheManager.delete(key);
        return key;
    }

    static async load(key) {
        const cachedUrl = await CacheManager.get(key);
        if (cachedUrl) return cachedUrl;

        const value = await LINKS.get(key);
        if (!value) return null;

        const [mode, createTime, url] = value.split(';');
        
        if (mode !== '0' && CONFIG.shorten_timeout > 0 && 
            Date.now() - parseInt(createTime) > CONFIG.shorten_timeout) {
            const host = new URL(url).host;
            if (!await Utils.checkWhite(host)) {
                return null;
            }
        }

        await CacheManager.set(key, url);
        return url;
    }
}

// handler.js - 请求处理模块
async function handleRequest(request, event) {
    if (request.method === "POST") {
        if (!await RateLimiter.checkLimit(request, event)) {
            return new Response(JSON.stringify({
                status: 429,
                key: "Error: Too many requests"
            }), {
                headers: {
                    "content-type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST"
                },
                status: 429
            });
        }

        const req = await request.json();
        const admin = await Utils.md5(req.url + CONFIG.password) === req.hash;

        if (!await Utils.checkURL(req.url) || 
            (!admin && !CONFIG.demo_mode && !await Utils.checkWhite(new URL(req.url).host))) {
            return new Response(JSON.stringify({
                status: 500,
                key: "Error: Url illegal."
            }), {
                headers: {
                    "content-type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST"
                }
            });
        }

        try {
            const key = await UrlManager.save(req.url, req.key, admin);
            return new Response(JSON.stringify({
                status: 200,
                key: `/${key}`
            }), {
                headers: {
                    "content-type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST"
                }
            });
        } catch (error) {
            return new Response(JSON.stringify({
                status: 500,
                key: "Error: KV write limitation reached."
            }), {
                headers: {
                    "content-type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST"
                }
            });
        }
    }

    if (request.method === "OPTIONS") {
        return new Response("", {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        });
    }

    const path = new URL(request.url).pathname.split("/")[1];
    if (!path) {
        const html = await fetch(`https://dv.neee.win/dv/cdn.jsdelivr.net/gh/${CONFIG.github_repo}${CONFIG.github_version}/index.html`);
        const text = (await html.text())
            .replaceAll("###GITHUB_REPO###", CONFIG.github_repo)
            .replaceAll("###GITHUB_VERSION###", CONFIG.github_version)
            .replaceAll("###DEMO_NOTICE###", CONFIG.demo_notice);
        return new Response(text, {
            headers: {"content-type": "text/html;charset=UTF-8"}
        });
    }

    const url = await UrlManager.load(path);
    if (!url) {
        return new Response(`<!DOCTYPE html><body><h1>404 Not Found.</h1><p>The url you visit is not found.</p></body>`, {
            headers: {"content-type": "text/html;charset=UTF-8"},
            status: 404
        });
    }

    return Response.redirect(url, 302);
}

// main.js - 主入口
addEventListener("fetch", event => {
    event.respondWith(handleRequest(event.request, event));
});
