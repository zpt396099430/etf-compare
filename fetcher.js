const https = require('https');

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = https.request({ hostname, path, method: 'GET', headers }, res => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const chunks = [];
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': buf.length }
    }, res => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

const BASE = 'e.gtfund.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const REFERER = 'https://e.gtfund.com/Etrade/Jijin/view/id/';

async function getCookie(fundCode) {
  console.log(`[Cookie] 开始获取基金 ${fundCode} 的 Cookie...`);
  const r1 = await httpsGet(BASE, `/Etrade/Jijin/view/id/${fundCode}`, { 'User-Agent': UA });
  console.log(`[Cookie] Step 1 HTTP状态: ${r1.status}`);
  const sc = r1.headers['set-cookie'] || [];
  console.log(`[Cookie] Set-Cookie: ${sc.join(';').substring(0, 100)}...`);
  const m1 = sc.join(';').match(/C3VK=([a-f0-9]+)/);
  if (!m1) {
    console.error(`[Cookie] 错误: 无法从 Set-Cookie 中提取 C3VK`);
    throw new Error('Failed to get initial cookie');
  }
  console.log(`[Cookie] Step 1 获取到 C3VK: ${m1[1].substring(0, 20)}...`);

  const r2 = await httpsGet(BASE, `/Etrade/Jijin/view/id/${fundCode}`, {
    'User-Agent': UA,
    'Cookie': `C3VK=${m1[1]}`
  });
  console.log(`[Cookie] Step 2 HTTP状态: ${r2.status}`);
  const body2 = r2.body.toString();
  const m2 = body2.match(/C3VK=([a-f0-9]+)/);
  const finalCookie = `C3VK=${m2 ? m2[1] : m1[1]}`;
  console.log(`[Cookie] 最终 Cookie: ${finalCookie.substring(0, 30)}...`);
  return finalCookie;
}

// 尝试获取 XML，返回 null 表示失败
async function tryDownloadXML(fundCode, listCode, date, cookie) {
  const url = `/Etrade/FundDetail/getETFFile/id/${listCode}/date/${date}`;
  console.log(`[DownloadXML] 尝试列表代码: ${listCode}`);
  
  const r = await httpsGet(BASE, url, {
    'User-Agent': UA,
    'Referer': REFERER + fundCode,
    'Cookie': cookie
  });
  console.log(`[DownloadXML] HTTP状态: ${r.status}, 大小: ${r.body.length} 字节`);
  
  if (r.status !== 200) return null;
  
  const content = r.body.toString('utf8');
  console.log(`[DownloadXML] 返回内容前100字符: ${content.substring(0, 100)}`);
  
  // 验证是否为有效 XML（至少包含 <?xml 或 <SSEPortfolioCompositionFile）
  if (!content.includes('<?xml') && !content.includes('<SSEPortfolioCompositionFile')) {
    console.log(`[DownloadXML] 内容不是有效的 XML，跳过`);
    return null;
  }
  
  return content;
}

async function downloadXML(fundCode, date, cookie) {
  // 策略：先尝试 fundCode + 1，失败再试原始 fundCode
  const listCodePlus1 = String(parseInt(fundCode) + 1).padStart(6, '0');
  const listCodeOriginal = fundCode;
  
  console.log(`[DownloadXML] 基金: ${fundCode}, 日期: ${date}, 尝试: ${listCodePlus1} → ${listCodeOriginal}`);
  
  // 第一次尝试：fundCode + 1
  let result = await tryDownloadXML(fundCode, listCodePlus1, date, cookie);
  if (result) {
    console.log(`[DownloadXML] ✓ 使用 +1 代码(${listCodePlus1})成功`);
    return result;
  }
  
  // 第二次尝试：原始 fundCode
  console.log(`[DownloadXML] +1失败，尝试原始代码...`);
  result = await tryDownloadXML(fundCode, listCodeOriginal, date, cookie);
  if (result) {
    console.log(`[DownloadXML] ✓ 使用原始代码(${listCodeOriginal})成功`);
    return result;
  }
  
  throw new Error(`无法获取基金 ${fundCode} 的PCF文件，代码 ${listCodePlus1} 和 ${listCodeOriginal} 均失败`);
}

// 尝试调用 API，返回 null 表示失败
async function tryFetchAPI(fundCode, listCode, dateFormatted, cookie) {
  const body = JSON.stringify({ api: 'info.etf', params: { code: listCode, date: dateFormatted } });
  console.log(`[API] 尝试列表代码: ${listCode}`);
  console.log(`[API] 请求: ${body}`);

  const r = await httpsPost(BASE, '/Etrade/Public/cochin/info.etf', {
    'User-Agent': UA,
    'Content-Type': 'application/json; charset=utf-8',
    'Referer': REFERER + fundCode,
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': cookie
  }, body);
  
  console.log(`[API] HTTP状态: ${r.status}, 响应: ${r.body.substring(0, 150)}`);

  try {
    const data = JSON.parse(r.body);
    if (data.httpCode && data.httpCode !== 200) {
      console.log(`[API] 返回错误: ${data.message}`);
      return null;
    }
    return data;
  } catch (e) {
    console.log(`[API] JSON解析失败`);
    return null;
  }
}

async function fetchAPIData(fundCode, date, cookie) {
  const dateFormatted = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const listCodePlus1 = String(parseInt(fundCode) + 1).padStart(6, '0');
  const listCodeOriginal = fundCode;
  
  console.log(`[API] 基金: ${fundCode}, 日期: ${dateFormatted}, 尝试: ${listCodePlus1} → ${listCodeOriginal}`);

  // 第一次尝试：fundCode + 1
  let result = await tryFetchAPI(fundCode, listCodePlus1, dateFormatted, cookie);
  if (result) {
    console.log(`[API] ✓ 使用 +1 代码(${listCodePlus1})成功`);
    return result;
  }
  
  // 第二次尝试：原始 fundCode
  console.log(`[API] +1失败，尝试原始代码...`);
  result = await tryFetchAPI(fundCode, listCodeOriginal, dateFormatted, cookie);
  if (result) {
    console.log(`[API] ✓ 使用原始代码(${listCodeOriginal})成功`);
    return result;
  }
  
  throw new Error(`无法获取基金 ${fundCode} 的API数据，代码 ${listCodePlus1} 和 ${listCodeOriginal} 均失败`);
}

module.exports = { getCookie, downloadXML, fetchAPIData };
