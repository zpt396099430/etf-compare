const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
  attributeNamePrefix: '@_'
});

// Header fields (top-level, non-list)
const HEADER_FIELDS = [
  'FundInstrumentID','CreationRedemptionUnit','TradingDay','PreTradingDay',
  'NAVperCU','NAV','PreCashComponent','EstimatedCashComponent','MaxCashRatio',
  'CreationLimit','RedemptionLimit','NetCreationLimit','NetRedemptionLimit',
  'NetCreationLimitPerUser','NetRedemptionLimitPerUser','CreationLimitPerUser',
  'RedemptionLimitPerUser','PublishIOPVFlag','CreationRedemptionSwitch',
  'CreationRedemptionMechanism','RecordNumber'
];

// Security fields
const SECURITY_FIELDS = [
  'InstrumentID','InstrumentName','Quantity','SubstitutionFlag',
  'CreationPremiumRate','RedemptionDiscountRate','SubstitutionCashAmount',
  'UnderlyingSecurityID'
];

const ROOT_CANDIDATES = [
  'SSEPortfolioCompositionFile',
  'SZSEPortfolioCompositionFile',
  'PortfolioCompositionFile'
];

const LIST_CANDIDATES = [
  ['ComponentList', 'Component'],
  ['componentList', 'component'],
  ['Components', 'Component'],
  ['components', 'component']
];

function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '').trim() : '';
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function pickRoot(doc) {
  if (!doc || typeof doc !== 'object') return {};
  for (const key of ROOT_CANDIDATES) {
    if (doc[key]) return doc[key];
  }
  const firstObjectKey = Object.keys(doc).find(key => doc[key] && typeof doc[key] === 'object');
  return firstObjectKey ? doc[firstObjectKey] : doc;
}

function getComponentItems(root) {
  for (const [listKey, itemKey] of LIST_CANDIDATES) {
    const list = root?.[listKey]?.[itemKey];
    if (list) return Array.isArray(list) ? list : [list];
  }

  const directList = firstDefined(root, ['Component', 'component']);
  if (directList) return Array.isArray(directList) ? directList : [directList];

  return [];
}

function pickHeader(root, field) {
  const aliases = {
    FundInstrumentID: ['FundInstrumentID', 'fundInstrumentID', 'FundCode', 'fundCode'],
    CreationRedemptionUnit: ['CreationRedemptionUnit', 'creationRedemptionUnit'],
    TradingDay: ['TradingDay', 'tradingDay', 'TradeDate', 'tradeDate'],
    PreTradingDay: ['PreTradingDay', 'preTradingDay', 'PrevTradingDay'],
    NAVperCU: ['NAVperCU', 'NAVPerCU', 'navPerCU'],
    PreCashComponent: ['PreCashComponent', 'PreviousCashComponent'],
    EstimatedCashComponent: ['EstimatedCashComponent', 'EstimateCashComponent'],
    PublishIOPVFlag: ['PublishIOPVFlag', 'IOPVFlag'],
    CreationRedemptionSwitch: ['CreationRedemptionSwitch', 'CreationRedemptionFlag']
  };
  return firstDefined(root, aliases[field] || [field]);
}

function pickSecurityValue(item, field) {
  const aliases = {
    InstrumentID: ['InstrumentID', 'SecurityID', 'securityID', 'Code', 'code'],
    InstrumentName: ['InstrumentName', 'SecurityName', 'securityName', 'Name', 'name'],
    Quantity: ['Quantity', 'Qty', 'quantity'],
    SubstitutionFlag: ['SubstitutionFlag', 'CashSubstitutionFlag'],
    CreationPremiumRate: ['CreationPremiumRate', 'CreationPremiumRatio'],
    RedemptionDiscountRate: ['RedemptionDiscountRate', 'RedemptionDiscountRatio'],
    SubstitutionCashAmount: ['SubstitutionCashAmount', 'CashAmount'],
    UnderlyingSecurityID: ['UnderlyingSecurityID', 'MarketID', 'ExchangeID']
  };
  return firstDefined(item, aliases[field] || [field]);
}

/**
 * Parse XML file (source A or B) into normalized structure
 * Returns { fundCode, tradingDay, headers: {}, securities: { id: {} } }
 */
function parseXML(xmlContent) {
  const cleaned = stripBom(xmlContent);
  if (!cleaned) throw new Error('上传文件为空');

  const doc = parser.parse(cleaned);
  const root = pickRoot(doc);

  const headers = {};
  for (const f of HEADER_FIELDS) {
    const value = pickHeader(root, f);
    if (value !== undefined && value !== null && value !== '') headers[f] = String(value);
  }

  const securities = {};
  const items = getComponentItems(root);
  for (const item of items) {
    const rawId = pickSecurityValue(item, 'InstrumentID');
    if (rawId === undefined || rawId === null || rawId === '') continue;

    const id = String(rawId).trim();
    if (!id) continue;

    securities[id] = {};
    for (const f of SECURITY_FIELDS) {
      const value = pickSecurityValue(item, f);
      if (value !== undefined && value !== null && value !== '') securities[id][f] = String(value);
    }
  }

  return {
    fundCode: headers.FundInstrumentID,
    tradingDay: headers.TradingDay,
    headers,
    securities
  };
}

/**
 * Normalize cochin API response (source C) into same structure
 */
function parseAPIData(apiData) {
  const headers = {};

  // info array → header
  if (Array.isArray(apiData.info)) {
    for (const [, value, key] of apiData.info) {
      if (key) headers[key] = String(value ?? '');
    }
  }

  // t-1 properties
  if (apiData['t-1']?.properties) {
    for (const [, value, key] of apiData['t-1'].properties) {
      if (key) headers[`T1_${key}`] = String(value ?? '');
    }
  }

  // t properties
  if (apiData.t?.properties) {
    for (const [, value, key] of apiData.t.properties) {
      if (key) headers[`T_${key}`] = String(value ?? '');
    }
  }

  // Map API header keys → XML header keys where possible
  const keyMap = {
    FundInstrumentID: 'FundInstrumentID',
    TradingDay: 'TradingDay',
    T1_NAVperCU: 'NAVperCU',
    T1_NAV: 'NAV',
    T1_PreCashComponent: 'PreCashComponent',
    T_EstimatedCashComponent: 'EstimatedCashComponent',
    T_MaxCashRatio: 'MaxCashRatio',
    T_CreationLimit: 'CreationLimit',
    T_RedemptionLimit: 'RedemptionLimit',
    T_NetCreationLimit: 'NetCreationLimit',
    T_NetRedemptionLimit: 'NetRedemptionLimit',
    T_NetCreationLimitPerUser: 'NetCreationLimitPerUser',
    T_NetRedemptionLimitPerUser: 'NetRedemptionLimitPerUser',
    T_CreationLimitPerUser: 'CreationLimitPerUser',
    T_RedemptionLimitPerUser: 'RedemptionLimitPerUser',
    T_PublishIOPVFlag: 'PublishIOPVFlag',
    T_CreationRedemptionUnit: 'CreationRedemptionUnit',
    T_CreationRedemptionSwitch: 'CreationRedemptionSwitch',
    T_CreationRedemptionMechanism: 'CreationRedemptionMechanism',
  };

  const normalizedHeaders = {};
  for (const [apiKey, xmlKey] of Object.entries(keyMap)) {
    if (headers[apiKey] !== undefined) normalizedHeaders[xmlKey] = headers[apiKey];
  }
  // keep unmapped keys too
  for (const [k, v] of Object.entries(headers)) {
    if (!Object.keys(keyMap).includes(k)) normalizedHeaders[k] = v;
  }

  // securities
  const securities = {};
  if (apiData.securities?.rows) {
    const cols = apiData.securities.cols;
    const colMap = {
      '证券ID': 'InstrumentID',
      '证券简称': 'InstrumentName',
      '该证券数量': 'Quantity',
      '替代标志': 'SubstitutionFlag',
      '申购溢价比例': 'CreationPremiumRate',
      '赎回折价比例': 'RedemptionDiscountRate',
      '替代金额': 'SubstitutionCashAmount',
      '市场ID': 'UnderlyingSecurityID'
    };
    for (const row of apiData.securities.rows) {
      const id = String(row[0]);
      securities[id] = {};
      cols.forEach((col, i) => {
        const xmlField = colMap[col] || col;
        securities[id][xmlField] = String(row[i] ?? '');
      });
    }
  }

  return {
    fundCode: normalizedHeaders.FundInstrumentID,
    tradingDay: normalizedHeaders.TradingDay,
    headers: normalizedHeaders,
    securities
  };
}

module.exports = { parseXML, parseAPIData };
