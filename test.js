const github_repo = typeof(GITHUB_REPO)!="undefined" ? GITHUB_REPO
    : 'mithew/url-duan'
const github_version = typeof(GITHUB_VERSION)!="undefined" ? GITHUB_VERSION
    : '@main'
const password = typeof(PASSWORD)!="undefined" ? PASSWORD
    : 'AoEiuV020 yes'
const shorten_timeout = typeof(SHORTEN_TIMEOUT)!="undefined" ? SHORTEN_TIMEOUT.split("*").reduce((a,b)=>parseInt(a)*parseInt(b),1)
    : (1000 * 1 * 1)
const default_len = typeof(DEFAULT_LEN)!="undefined" ? parseInt(DEFAULT_LEN)
    : 4
const demo_mode = typeof(DEMO_MODE)!="undefined" ? DEMO_MODE === 'true'
    : false
const remove_completely = typeof(REMOVE_COMPLETELY)!="undefined" ? REMOVE_COMPLETELY === 'true'
    : true
const white_list = JSON.parse(typeof(WHITE_LIST)!="undefined" ? WHITE_LIST
    : `[
"020.name",
    ]`)
const demo_notice = typeof(DEMO_NOTICE)!="undefined" ? DEMO_NOTICE
    : ` `
//console.log(`${github_repo}, ${github_version}, ${password}, ${shorten_timeout}, ${demo_mode}, ${white_list}, ${demo_notice}`)
const html404 = `<!DOCTYPE html>
<body>
  <h1>404 Not Found.</h1>
  <p>The url you visit is not found.</p>
</body>`


async function randomString(len) {
  　　let $chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';     
  　　let maxPos = $chars.length;
　　let result = '';
　　for (i = 0; i < len; i++) {
　　　　result += $chars.charAt(Math.floor(Math.random() * maxPos));
　　}
　　return result;
}
async function checkURL(url){
    let str=url;
    let Expression=/^http(s)?:\/\/(.*@)?([\w-]+\.)*[\w-]+([_\-.,~!*:#()\w\/?%&=]*)?$/;
    let objExp=new RegExp(Expression);
    if(objExp.test(str)==true){
      if (str[0] == 'h')
        return true;
      else
        return false;
    }else{
        return false;
    }
} 
async function checkWhite(host){
    return white_list.some((h) => host == h || host.endsWith('.'+h))
} 
async function md5(message) {
  const msgUint8 = new TextEncoder().encode(message) // encode as (utf-8) Uint8Array
  const hashBuffer = await crypto.subtle.digest('MD5', msgUint8) // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer)) // convert buffer to byte array
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('') // convert bytes to hex string

  return hashHex
}
async function checkHash(url, hash) {
    if (!hash) {
        return false
    }
    return (await md5(url+password)) == hash
}
async function save_url(url, key, admin, len) {
　　len = len || default_len;
    const override = admin && key
    if (!override) {
        key = await randomString(len)
    }
    const is_exists = await load_url(key)
    console.log("key exists " + key + " " + is_exists)
    if (override || !is_exists) {
        var mode = 3
        if (admin) {
            mode = 0
        }
        let value = `${mode};${Date.now()};${url}`
        if (remove_completely && mode != 0 && !await checkWhite(new URL(url).host)) {
          // 利用expirationTtl实现过期记录自动删除，低于60秒会报错，
          let ttl = Math.max(60, shorten_timeout / 1000)
          console.log("key auto remove: " + key + ", " + ttl + "s")
          return await LINKS.put(key, value, {expirationTtl: ttl}),key
        } else {
          return await LINKS.put(key, value),key
        }
    } else {
        return await save_url(url, key, admin, len + 1)
    }
}
async function load_url(key) {
    const value = await LINKS.get(key)
    if (!value) {
        return null
    }
    const list = value.split(';')
    console.log("value split " + list)
    var url
    if (list.length == 1) {
        url = list[0]
    } else {
        url = list[2]
        const mode = parseInt(list[0])
        const create_time = parseInt(list[1])
        if (mode != 0 && shorten_timeout > 0
            && Date.now() - create_time > shorten_timeout) {
            const host = new URL(url).host
            if (await checkWhite(host)) {
                console.log('white list')
            } else {
                // 超时和找不到做同样的处理，
                console.log("shorten timeout")
                return null
            }
        }
    }
    return url
}
async function handleRequest(request) {
  console.log(request)
  if (request.method === "POST") {
    let req=await request.json()
    console.log("url " + req["url"])
    let admin = await checkHash(req["url"], req["hash"])
    console.log("admin " + admin)
    if(!await checkURL(req["url"]) || (!admin && !demo_mode && !await checkWhite(new URL(req["url"]).host))){
    return new Response(`{"status":500,"key":": Error: Url illegal."}`, {
      headers: {
      "content-type": "text/html;charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods": "POST",
      },
    })}
    let stat,random_key=await save_url(req["url"], req["key"], admin)
    console.log("stat " + stat)
    if (typeof(stat) == "undefined"){
      return new Response(`{"status":200,"key":"/`+random_key+`"}`, {
      headers: {
      "content-type": "text/html;charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods": "POST",
      },
    })
    }else{
      return new Response(`{"status":200,"key":": Error:Reach the KV write limitation."}`, {
      headers: {
      "content-type": "text/html;charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods": "POST",
      },
    })}
  }else if(request.method === "OPTIONS"){  
      return new Response(``, {
      headers: {
      "content-type": "text/html;charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods": "POST",
      },
    })

  }

  const requestURL = new URL(request.url)
  const path = requestURL.pathname.split("/")[1]
  console.log(path)
  if(!path){

    const html= await fetch(`https://dv.neee.win/dv/cdn.jsdelivr.net/gh/${github_repo}${github_version}/index.html`)
    const text = (await html.text())
        .replaceAll("###GITHUB_REPO###", github_repo)
        .replaceAll("###GITHUB_VERSION###", github_version)
        .replaceAll("###DEMO_NOTICE###", demo_notice)
    
    return new Response(text, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
    },
  })
  }
  const url = await load_url(path)
  if (!url) {
    console.log('not found')
    return new Response(html404, {
      headers: {
        "content-type": "text/html;charset=UTF-8",
      },
      status: 404
    })
  }
  return Response.redirect(url, 302)
}

addEventListener("fetch", async event => {
  event.respondWith(handleRequest(event.request))
})
