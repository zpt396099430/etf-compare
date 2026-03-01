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
  // Step 1: get initial cookie from Set-Cookie header
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

  // Step 2: use that cookie to get the real session cookie from JS challenge response
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

/**
 * Download the XML PCF file for a given fund code and date (YYYYMMDD)
 */
async function downloadXML(fundCode, date, cookie) {
  // The申购赎回清单 uses fundCode+1 as the list code (e.g. 561300 → 561301)
  const listCode = String(parseInt(fundCode) + 1).padStart(6, '0');
  const url = `/Etrade/FundDetail/getETFFile/id/${listCode}/date/${date}`;
  console.log(`[DownloadXML] 基金: ${fundCode}, 列表代码: ${listCode}, 日期: ${date}`);
  console.log(`[DownloadXML] URL: https://${BASE}${url}`);
  console.log(`[DownloadXML] Cookie: ${cookie.substring(0, 30)}...`);
  
  const r = await httpsGet(BASE, url, {
    'User-Agent': UA,
    'Referer': REFERER + fundCode,
    'Cookie': cookie
  });
  console.log(`[DownloadXML] HTTP状态: ${r.status}, 响应大小: ${r.body.length} 字节`);
  
  if (r.status !== 200) {
    console.error(`[DownloadXML] 错误: HTTP ${r.status}`);
    console.error(`[DownloadXML] 响应内容: ${r.body.toString().substring(0, 200)}`);
    throw new Error(`Download failed: HTTP ${r.status}`);
  }
  const result = r.body.toString('utf8');
  console.log(`[DownloadXML] 成功, XML前200字符: ${result.substring(0, 200)}`);
  return result;
}

/**
 * Fetch申购赎回清单 data from cochin API
 */
async function fetchAPIData(fundCode, date, cookie) {
  // date format: YYYY-MM-DD
  const dateFormatted = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const listCode = String(parseInt(fundCode) + 1).padStart(6, '0');
  const body = JSON.stringify({ api: 'info.etf', params: { code: listCode, date: dateFormatted } });
  
  console.log(`[API] 基金: ${fundCode}, 列表代码: ${listCode}, 日期: ${dateFormatted}`);
  console.log(`[API] URL: https://${BASE}/Etrade/Public/cochin/info.etf`);
  console.log(`[API] 请求体: ${body}`);
  console.log(`[API] Cookie: ${cookie.substring(0, 30)}...`);

  const r = await httpsPost(BASE, '/Etrade/Public/cochin/info.etf', {
    'User-Agent': UA,
    'Content-Type': 'application/json; charset=utf-8',
    'Referer': REFERER + fundCode,
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': cookie
  }, body);
  
  console.log(`[API] HTTP状态: ${r.status}, 响应: ${r.body.substring(0, 200)}`);

  const data = JSON.parse(r.body);
  if (data.httpCode && data.httpCode !== 200) {
    console.error(`[API] 错误: httpCode=${data.httpCode}, message=${data.message}`);
    throw new Error(`API error: ${data.message}`);
  }
  console.log(`[API] 成功获取数据`);
  return data;
}

module.exports = { getCookie, downloadXML, fetchAPIData };
