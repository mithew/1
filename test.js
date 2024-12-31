// 需要在 Workers 环境变量中设置 GITHUB_TOKEN

const CONFIG = {
  UPSTREAM: "raw.githubusercontent.com",
  UPSTREAM_PATH: "/mithew/2/main",
  UPSTREAM_MOBILE: "raw.githubusercontent.com",
  BLOCKED_REGION: [],
  BLOCKED_IP_ADDRESS: ["0.0.0.0", "127.0.0.1"],
  HTTPS: true,
  DISABLE_CACHE: true,
  RATE_LIMIT: {
    WINDOW_SIZE: 120,    // 时间窗口(秒)
    MAX_REQUESTS: 30,    // 窗口内最大请求数
  }
};

// 请求记录缓存
const requestCache = new Map();

// 预编译的替换规则
const replaceRules = new Map();

// 清理过期请求记录
function cleanupRequestCache() {
  const now = Date.now();
  const windowStart = now - (CONFIG.RATE_LIMIT.WINDOW_SIZE * 1000);
  
  for (const [ip, record] of requestCache.entries()) {
    record.requests = record.requests.filter(time => time > windowStart);
    if (record.requests.length === 0) {
      requestCache.delete(ip);
    }
  }
}

// 频率限制检查
function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - (CONFIG.RATE_LIMIT.WINDOW_SIZE * 1000);
  
  // 每次检查时顺便清理缓存
  cleanupRequestCache();
  
  let record = requestCache.get(ip);
  if (!record) {
    record = { requests: [] };
    requestCache.set(ip, record);
  }

  record.requests = record.requests.filter(time => time > windowStart);
  record.requests.push(now);

  return record.requests.length <= CONFIG.RATE_LIMIT.MAX_REQUESTS;
}

// 响应转换器
class ResponseTransformer {
  constructor(upstream, customDomain) {
    this.upstream = upstream;
    this.customDomain = customDomain;
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
  }

  transform(chunk, controller) {
    let text = this.decoder.decode(chunk);
    replaceRules.forEach((value, key) => {
      text = text.replace(key, value);
    });
    controller.enqueue(this.encoder.encode(text));
  }
}

// 设备检测
function device_status(user_agent_info) {
  const agents = [
    "Android", "iPhone", "SymbianOS",
    "Windows Phone", "iPad", "iPod"
  ];
  return !agents.some(agent => user_agent_info?.includes(agent));
}

// 创建错误响应
function createErrorResponse(message, status = 403) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store'
    }
  });
}

// 主要请求处理函数
async function handleRequest(request) {
  try {
    const region = request.headers.get("cf-ipcountry")?.toUpperCase();
    const ip_address = request.headers.get("cf-connecting-ip");
    const user_agent = request.headers.get("user-agent");

    // 频率限制检查
    if (!checkRateLimit(ip_address)) {
      return createErrorResponse(
        "Rate limit exceeded. Please try again later.",
        429
      );
    }

    // 区域和IP限制检查
    if (CONFIG.BLOCKED_REGION.includes(region)) {
      return createErrorResponse(
        "Access denied: Service not available in your region."
      );
    }
    
    if (CONFIG.BLOCKED_IP_ADDRESS.includes(ip_address)) {
      return createErrorResponse(
        "Access denied: Your IP address is blocked."
      );
    }

    // URL处理
    let url = new URL(request.url);
    url.protocol = CONFIG.HTTPS ? "https:" : "http:";
    const upstream_domain = device_status(user_agent) ? 
      CONFIG.UPSTREAM : CONFIG.UPSTREAM_MOBILE;
    
    url.host = upstream_domain;
    url.pathname = url.pathname === "/" ? 
      CONFIG.UPSTREAM_PATH : CONFIG.UPSTREAM_PATH + url.pathname;

    // 请求头设置
    const new_request_headers = new Headers(request.headers);
    new_request_headers.set("Host", upstream_domain);
    new_request_headers.set("Referer", `${url.protocol}//${url.hostname}`);
    new_request_headers.set("Authorization", `token ${GITHUB_TOKEN}`);

    // 发送请求
    const original_response = await fetch(url.href, {
      method: request.method,
      headers: new_request_headers,
      body: request.body
    });

    // WebSocket检查
    if (new_request_headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return original_response;
    }

    // 响应头处理
    const new_response_headers = new Headers(original_response.headers);
    new_response_headers.set("Cache-Control", 
      CONFIG.DISABLE_CACHE ? "no-store" : "max-age=43200000"
    );
    new_response_headers.set("access-control-allow-origin", "*");
    new_response_headers.set("access-control-allow-credentials", "true");
    
    // 删除不需要的安全头
    ["content-security-policy", 
     "content-security-policy-report-only",
     "clear-site-data"
    ].forEach(header => new_response_headers.delete(header));

    // 使用转换流处理响应
    const transformer = new ResponseTransformer(upstream_domain, url.hostname);
    const transformed_stream = original_response.body
      .pipeThrough(new TransformStream(transformer));

    return new Response(transformed_stream, {
      status: original_response.status,
      headers: new_response_headers
    });
    
  } catch (error) {
    console.error("Request processing error:", error);
    return createErrorResponse(
      `Service error: ${error.message}`,
      500
    );
  }
}

// 事件监听器
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
