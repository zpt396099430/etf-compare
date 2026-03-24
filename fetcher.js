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
const MOBILE_BASE = 'm.gtfund.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const REFERER = 'https://e.gtfund.com/Etrade/Jijin/view/id/';

function isSZSECode(fundCode) {
  return /^1\d{5}$/.test(String(fundCode));
}

function getAPICandidateCodes(fundCode) {
  const code = String(fundCode).padStart(6, '0');
  const plus1 = String(parseInt(code, 10) + 1).padStart(6, '0');
  return isSZSECode(code) ? [code, plus1] : [plus1, code];
}

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

async function tryDownloadXMLNew(fundCode, date) {
  const url = `/cochin/etf/download/${fundCode}/${date}`;
  console.log(`[DownloadXML] 尝试新下载地址: ${MOBILE_BASE}${url}`);

  const r = await httpsGet(MOBILE_BASE, url, { 'User-Agent': UA, 'Referer': REFERER + fundCode });
  console.log(`[DownloadXML] 新地址 HTTP状态: ${r.status}, 大小: ${r.body.length} 字节`);

  if (r.status !== 200) return null;

  const content = r.body.toString('utf8');
  console.log(`[DownloadXML] 新地址返回前100字符: ${content.substring(0, 100)}`);

  if (!content.includes('<?xml') && !content.includes('PortfolioCompositionFile') && !content.includes('<PCFFile')) {
    console.log(`[DownloadXML] 新地址内容不是有效 XML，跳过`);
    return null;
  }

  return content;
}

// 旧下载接口保留做兜底
async function tryDownloadXMLOld(fundCode, listCode, date, cookie) {
  const url = `/Etrade/FundDetail/getETFFile/id/${listCode}/date/${date}`;
  console.log(`[DownloadXML] 兜底旧地址尝试列表代码: ${listCode}`);

  const r = await httpsGet(BASE, url, {
    'User-Agent': UA,
    'Referer': REFERER + fundCode,
    'Cookie': cookie
  });
  console.log(`[DownloadXML] 旧地址 HTTP状态: ${r.status}, 大小: ${r.body.length} 字节`);

  if (r.status !== 200) return null;

  const content = r.body.toString('utf8');
  console.log(`[DownloadXML] 旧地址返回前100字符: ${content.substring(0, 100)}`);

  if (!content.includes('<?xml') && !content.includes('PortfolioCompositionFile') && !content.includes('<PCFFile')) {
    console.log(`[DownloadXML] 旧地址内容不是有效 XML，跳过`);
    return null;
  }

  return content;
}

async function downloadXML(fundCode, date, cookie) {
  console.log(`[DownloadXML] 基金: ${fundCode}, 日期: ${date}`);

  const direct = await tryDownloadXMLNew(fundCode, date);
  if (direct) {
    console.log(`[DownloadXML] ✓ 使用新下载地址成功`);
    return direct;
  }

  const listCodePlus1 = String(parseInt(fundCode, 10) + 1).padStart(6, '0');
  const listCodeOriginal = String(fundCode).padStart(6, '0');

  let result = await tryDownloadXMLOld(fundCode, listCodePlus1, date, cookie);
  if (result) {
    console.log(`[DownloadXML] ✓ 使用旧地址 +1 代码(${listCodePlus1})成功`);
    return result;
  }

  result = await tryDownloadXMLOld(fundCode, listCodeOriginal, date, cookie);
  if (result) {
    console.log(`[DownloadXML] ✓ 使用旧地址原始代码(${listCodeOriginal})成功`);
    return result;
  }

  throw new Error(`无法获取基金 ${fundCode} 的PCF文件，新旧下载地址均失败`);
}

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
  const candidates = getAPICandidateCodes(fundCode);

  console.log(`[API] 基金: ${fundCode}, 日期: ${dateFormatted}, 尝试顺序: ${candidates.join(' → ')}`);

  for (const code of candidates) {
    const result = await tryFetchAPI(fundCode, code, dateFormatted, cookie);
    if (result) {
      console.log(`[API] ✓ 使用代码(${code})成功`);
      return result;
    }
  }

  throw new Error(`无法获取基金 ${fundCode} 的API数据，尝试代码 ${candidates.join(' / ')} 均失败`);
}

module.exports = { getCookie, downloadXML, fetchAPIData };
