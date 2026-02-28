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
  // Step 1: get initial cookie from Set-Cookie header
  const r1 = await httpsGet(BASE, `/Etrade/Jijin/view/id/${fundCode}`, { 'User-Agent': UA });
  const sc = r1.headers['set-cookie'] || [];
  const m1 = sc.join(';').match(/C3VK=([a-f0-9]+)/);
  if (!m1) throw new Error('Failed to get initial cookie');

  // Step 2: use that cookie to get the real session cookie from JS challenge response
  const r2 = await httpsGet(BASE, `/Etrade/Jijin/view/id/${fundCode}`, {
    'User-Agent': UA,
    'Cookie': `C3VK=${m1[1]}`
  });
  const body2 = r2.body.toString();
  const m2 = body2.match(/C3VK=([a-f0-9]+)/);
  return `C3VK=${m2 ? m2[1] : m1[1]}`;
}

/**
 * Download the XML PCF file for a given fund code and date (YYYYMMDD)
 */
async function downloadXML(fundCode, date, cookie) {
  // The申购赎回清单 uses fundCode+1 as the list code (e.g. 561300 → 561301)
  const listCode = String(parseInt(fundCode) + 1).padStart(6, '0');
  const r = await httpsGet(BASE, `/Etrade/FundDetail/getETFFile/id/${listCode}/date/${date}`, {
    'User-Agent': UA,
    'Referer': REFERER + fundCode,
    'Cookie': cookie
  });
  if (r.status !== 200) throw new Error(`Download failed: HTTP ${r.status}`);
  return r.body.toString('utf8');
}

/**
 * Fetch申购赎回清单 data from cochin API
 */
async function fetchAPIData(fundCode, date, cookie) {
  // date format: YYYY-MM-DD
  const dateFormatted = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const listCode = String(parseInt(fundCode) + 1).padStart(6, '0');
  const body = JSON.stringify({ api: 'info.etf', params: { code: listCode, date: dateFormatted } });

  const r = await httpsPost(BASE, '/Etrade/Public/cochin/info.etf', {
    'User-Agent': UA,
    'Content-Type': 'application/json; charset=utf-8',
    'Referer': REFERER + fundCode,
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': cookie
  }, body);

  const data = JSON.parse(r.body);
  if (data.httpCode && data.httpCode !== 200) throw new Error(`API error: ${data.message}`);
  return data;
}

module.exports = { getCookie, downloadXML, fetchAPIData };
