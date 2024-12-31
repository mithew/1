// 从环境变量中获取配置
addEventListener("fetch", (event) => {
  event.respondWith(fetchAndApply(event.request, event.env)); // ■ 将 env 作为参数传递给 fetchAndApply
});

async function fetchAndApply(request, env) { // ■ 添加 env 参数
  const upstream = env.UPSTREAM || "raw.githubusercontent.com"; // ■ 使用 env 对象访问环境变量
  const upstreamPath = env.UPSTREAM_PATH || "/mithew/2/main"; // ■ 使用 env 对象访问环境变量
  const githubToken = env.GITHUB_TOKEN || "ghp_xxx"; // ■ 使用 env 对象访问环境变量
  const upstreamMobile = env.UPSTREAM_MOBILE || upstream; // ■ 使用 env 对象访问环境变量
  const blockedRegion = env.BLOCKED_REGION ? env.BLOCKED_REGION.split(',') : []; // ■ 使用 env 对象访问环境变量
  const blockedIpAddress = env.BLOCKED_IP_ADDRESS ? env.BLOCKED_IP_ADDRESS.split(',') : []; // ■ 使用 env 对象访问环境变量
  const https = env.HTTPS === 'true'; // ■ 使用 env 对象访问环境变量
  const disableCache = env.DISABLE_CACHE === 'true'; // ■ 使用 env 对象访问环境变量
  const replaceDict = {
    $upstream: env.CUSTOM_DOMAIN || "$custom_domain", // ■ 使用 env 对象访问环境变量
    $custom_domain: env.CUSTOM_DOMAIN || "$custom_domain", // ■ 使用 env 对象访问环境变量
  };

  // 请求频率限制配置
  const TIME_WINDOW = 120 * 1000; // 时间
  const REQUEST_LIMIT = 25; // 请求限制
  const ipRequestMap = new Map();

  // 定时清理过期的IP请求记录
  setInterval(() => {
    const now = Date.now();
    for (const [ip, { timestamp }] of ipRequestMap.entries()) {
      if (now - timestamp > TIME_WINDOW) {
        ipRequestMap.delete(ip);
      }
    }
  }, TIME_WINDOW);

  const region = request.headers.get("cf-ipcountry")?.toUpperCase();
  const ip_address = request.headers.get("cf-connecting-ip");
  const user_agent = request.headers.get("user-agent");

  // 检查IP请求频率
  const now = Date.now();
  const ipRecord = ipRequestMap.get(ip_address);

  if (ipRecord) {
    if (now - ipRecord.timestamp <= TIME_WINDOW && ipRecord.count >= REQUEST_LIMIT) {
      return new Response("Too Many Requests: Please try again later.", { status: 429 });
    } else if (now - ipRecord.timestamp > TIME_WINDOW) {
      ipRequestMap.set(ip_address, { count: 1, timestamp: now });
    } else {
      ipRequestMap.set(ip_address, { count: ipRecord.count + 1, timestamp: now });
    }
  } else {
    ipRequestMap.set(ip_address, { count: 1, timestamp: now });
  }

  // 访问控制检查
  if (handleAccessControl(region, ip_address)) {
    return new Response("Access denied: Your region or IP is blocked.", { status: 403 });
  }

  // 确定上游域名
  const upstream_domain = await device_status(user_agent) ? upstream : upstreamMobile;

  // 构建请求URL
  let url = new URL(request.url);
  if (https) {
    url.protocol = "https:";
  } else {
    url.protocol = "http:";
  }
  url.host = upstream_domain;
  if (url.pathname === "/") {
    url.pathname = upstreamPath;
  } else {
    url.pathname = upstreamPath + url.pathname;
  }

  // 构建新的请求头
  let new_request_headers = new Headers(request.headers);
  new_request_headers.set("Host", upstream_domain);
  new_request_headers.set("Referer", url.protocol + "//" + url.hostname);
  new_request_headers.set("Authorization", `token ${githubToken}`);

  // 检查是否是WebSocket请求
  const connection_upgrade = new_request_headers.get("Upgrade");
  if (connection_upgrade && connection_upgrade.toLowerCase() === "websocket") {
    return fetch(url.href, { method: request.method, headers: new_request_headers, body: request.body });
  }

  // 发起原始请求
  let original_response = await fetch(url.href, {
    method: request.method,
    headers: new_request_headers,
    body: request.body,
  });

  // 处理响应
  let response = modifyResponse(original_response, url.hostname, upstream_domain);

  return response;
}

function handleAccessControl(region, ip_address) {
  if (blockedRegion.includes(region)) {
    return true; // Blocked region
  }
  if (blockedIpAddress.includes(ip_address)) {
    return true; // Blocked IP
  }
  return false;
}

function handleRateLimit(ip_address) {
  const now = Date.now();
  let ipRecord = ipRequestMap.get(ip_address);
  if (ipRecord) {
    if (now - ipRecord.timestamp <= TIME_WINDOW && ipRecord.count >= REQUEST_LIMIT) {
      return true; // Too many requests
    } else if (now - ipRecord.timestamp > TIME_WINDOW) {
      ipRequestMap.set(ip_address, { count: 1, timestamp: now });
    } else {
      ipRequestMap.set(ip_address, { count: ipRecord.count + 1, timestamp: now });
    }
  } else {
    ipRequestMap.set(ip_address, { count: 1, timestamp: now });
  }
  return false;
}

function modifyResponse(original_response, host_name, upstream_domain) {
  let original_response_clone = original_response.clone();
  let new_response_headers = new Headers(original_response.headers);
  let status = original_response.status;

  if (disableCache) {
    new_response_headers.set("Cache-Control", "no-store");
  } else {
    new_response_headers.set("Cache-Control", "max-age=43200000");
  }

  new_response_headers.set("access-control-allow-origin", "*");
  new_response_headers.set("access-control-allow-credentials", "true");
  new_response_headers.delete("content-security-policy");
  new_response_headers.delete("content-security-policy-report-only");
  new_response_headers.delete("clear-site-data");

  if (new_response_headers.get("x-pjax-url")) {
    new_response_headers.set("x-pjax-url", original_response.headers.get("x-pjax-url").replace(`//${upstream_domain}`, `//${host_name}`));
  }

  const content_type = new_response_headers.get("content-type");
  if (content_type && content_type.includes("text/html") && content_type.includes("UTF-8")) {
    const textStream = original_response.body.pipeThrough(new TextDecoderStream());
    const modifiedStream = textStream.pipeThrough(new TransformStream({
      transform: (chunk, controller) => {
        const modifiedChunk = replaceText(chunk, upstream_domain, host_name);
        controller.enqueue(modifiedChunk);
      }
    }));
    return new Response(modifiedStream, { status, headers: new_response_headers });
  } else {
    return new Response(original_response.body, { status, headers: new_response_headers });
  }
}

const replaceRegexMap = new Map();

function replaceText(text, upstream_domain, host_name) {
  for (const [searchKey, replaceKey] of Object.entries(replaceDict)) {
    let searchValue = searchKey;
    let replaceValue = replaceKey;

    if (searchKey === "$upstream") {
      searchValue = upstream_domain;
    } else if (searchKey === "$custom_domain") {
      searchValue = host_name;
    }

    if (replaceKey === "$upstream") {
      replaceValue = upstream_domain;
    } else if (replaceKey === "$custom_domain") {
      replaceValue = host_name;
    }

    let regex = replaceRegexMap.get(searchValue);
    if (!regex) {
      regex = new RegExp(searchValue, 'g');
      replaceRegexMap.set(searchValue, regex);
    }

    text = text.replace(regex, replaceValue);
  }
  return text;
}

async function device_status(user_agent_info) {
  const agents = [
    "Android",
    "iPhone",
    "SymbianOS",
    "Windows Phone",
    "iPad",
    "iPod",
  ];
  return !agents.some(agent => user_agent_info.includes(agent));
}
