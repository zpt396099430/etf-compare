const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
  attributeNamePrefix: '@_'
});

const HEADER_FIELDS = [
  'FundInstrumentID','CreationRedemptionUnit','TradingDay','PreTradingDay',
  'NAVperCU','NAV','PreCashComponent','EstimatedCashComponent','MaxCashRatio',
  'CreationLimit','RedemptionLimit','NetCreationLimit','NetRedemptionLimit',
  'NetCreationLimitPerUser','NetRedemptionLimitPerUser','CreationLimitPerUser',
  'RedemptionLimitPerUser','PublishIOPVFlag','CreationRedemptionSwitch',
  'CreationRedemptionMechanism','RecordNumber',
  'FundName','FundCompanyName','UnderlyingIndex'
];

const SECURITY_FIELDS = [
  'InstrumentID','InstrumentName','Quantity','SecurityIDSource','SubstitutionFlag',
  'CreationPremiumRate','RedemptionDiscountRate','SubstitutionCashAmount',
  'CreationCashSubstitute','RedemptionCashSubstitute','UnderlyingSecurityID'
];

const ROOT_CANDIDATES = [
  'SSEPortfolioCompositionFile',
  'SZSEPortfolioCompositionFile',
  'PortfolioCompositionFile',
  'PCFFile'
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
    FundInstrumentID: ['FundInstrumentID', 'fundInstrumentID', 'FundCode', 'fundCode', 'SecurityID'],
    FundName: ['FundName', 'fundName', 'FundShortName', 'Symbol'],
    FundCompanyName: ['FundCompanyName', 'fundCompanyName', 'FundManagementCompany'],
    UnderlyingIndex: ['UnderlyingIndex', 'UnderlyingSecurityID', 'TrackingIndexCode'],
    CreationRedemptionUnit: ['CreationRedemptionUnit', 'creationRedemptionUnit'],
    TradingDay: ['TradingDay', 'tradingDay', 'TradeDate', 'tradeDate'],
    PreTradingDay: ['PreTradingDay', 'preTradingDay', 'PrevTradingDay'],
    NAVperCU: ['NAVperCU', 'NAVPerCU', 'navPerCU'],
    NAV: ['NAV', 'nav'],
    PreCashComponent: ['PreCashComponent', 'PreviousCashComponent', 'CashComponent'],
    EstimatedCashComponent: ['EstimatedCashComponent', 'EstimateCashComponent'],
    MaxCashRatio: ['MaxCashRatio', 'maxCashRatio'],
    CreationLimit: ['CreationLimit', 'creationLimit'],
    RedemptionLimit: ['RedemptionLimit', 'redemptionLimit'],
    NetCreationLimit: ['NetCreationLimit', 'netCreationLimit'],
    NetRedemptionLimit: ['NetRedemptionLimit', 'netRedemptionLimit'],
    NetCreationLimitPerUser: ['NetCreationLimitPerUser', 'netCreationLimitPerUser'],
    NetRedemptionLimitPerUser: ['NetRedemptionLimitPerUser', 'netRedemptionLimitPerUser'],
    CreationLimitPerUser: ['CreationLimitPerUser', 'creationLimitPerUser'],
    RedemptionLimitPerUser: ['RedemptionLimitPerUser', 'redemptionLimitPerUser'],
    PublishIOPVFlag: ['PublishIOPVFlag', 'IOPVFlag', 'Publish'],
    CreationRedemptionSwitch: ['CreationRedemptionSwitch', 'CreationRedemptionFlag'],
    CreationRedemptionMechanism: ['CreationRedemptionMechanism'],
    RecordNumber: ['RecordNumber', 'RecordNum', 'TotalRecordNum']
  };
  return firstDefined(root, aliases[field] || [field]);
}

function pickSecurityValue(item, field) {
  const aliases = {
    InstrumentID: ['InstrumentID', 'SecurityID', 'securityID', 'Code', 'code', 'UnderlyingSecurityID'],
    InstrumentName: ['InstrumentName', 'SecurityName', 'securityName', 'Name', 'name', 'UnderlyingSymbol'],
    Quantity: ['Quantity', 'Qty', 'quantity', 'ComponentShare'],
    SecurityIDSource: ['SecurityIDSource', 'UnderlyingSecurityIDSource'],
    SubstitutionFlag: ['SubstitutionFlag', 'CashSubstitutionFlag', 'SubstituteFlag'],
    CreationPremiumRate: ['CreationPremiumRate', 'CreationPremiumRatio', 'PremiumRatio'],
    RedemptionDiscountRate: ['RedemptionDiscountRate', 'RedemptionDiscountRatio', 'DiscountRatio'],
    SubstitutionCashAmount: ['SubstitutionCashAmount', 'CashAmount', 'CreationCashSubstitute'],
    CreationCashSubstitute: ['CreationCashSubstitute', 'SubstitutionCashAmount', 'CashAmount'],
    RedemptionCashSubstitute: ['RedemptionCashSubstitute'],
    UnderlyingSecurityID: ['UnderlyingSecurityIDSource', 'MarketID', 'ExchangeID', 'UnderlyingSecurityID']
  };
  return firstDefined(item, aliases[field] || [field]);
}

function normalizeHeaderValues(headers) {
  if (headers.PublishIOPVFlag === 'Y') headers.PublishIOPVFlag = '1';
  if (headers.PublishIOPVFlag === 'N') headers.PublishIOPVFlag = '0';

  if (!headers.CreationRedemptionSwitch) {
    const creation = headers.__Creation;
    const redemption = headers.__Redemption;
    if (creation === 'Y' && redemption === 'Y') headers.CreationRedemptionSwitch = '1';
    else if (creation === 'N' && redemption === 'N') headers.CreationRedemptionSwitch = '0';
    else if (creation === 'N' && redemption === 'Y') headers.CreationRedemptionSwitch = '2';
    else if (creation === 'Y' && redemption === 'N') headers.CreationRedemptionSwitch = '3';
  }

  delete headers.__Creation;
  delete headers.__Redemption;
}

function normalizeSecurityFields(sec, { forApi = false } = {}) {
  if (forApi) {
    if (sec.CreationCashSubstitute === undefined && sec.SubstitutionCashAmount !== undefined) {
      sec.CreationCashSubstitute = sec.SubstitutionCashAmount;
    }
    if (sec.SubstitutionCashAmount === undefined && sec.CreationCashSubstitute !== undefined) {
      sec.SubstitutionCashAmount = sec.CreationCashSubstitute;
    }
    if (sec.RedemptionDiscountRate === undefined && sec.CreationPremiumRate !== undefined) {
      sec.RedemptionDiscountRate = sec.CreationPremiumRate;
    }
    if (sec.RedemptionCashSubstitute === undefined && sec.SubstitutionCashAmount !== undefined) {
      sec.RedemptionCashSubstitute = sec.SubstitutionCashAmount;
    }
  }
}

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

  headers.__Creation = firstDefined(root, ['Creation']);
  headers.__Redemption = firstDefined(root, ['Redemption']);
  normalizeHeaderValues(headers);

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
    normalizeSecurityFields(securities[id], { forApi: false });
  }

  return {
    fundCode: headers.FundInstrumentID,
    tradingDay: headers.TradingDay,
    headers,
    securities
  };
}

function parseAPIData(apiData) {
  const headers = {};

  if (Array.isArray(apiData.info)) {
    for (const [, value, key] of apiData.info) {
      if (key) headers[key] = String(value ?? '');
    }
  }

  if (apiData['t-1']?.properties) {
    for (const [, value, key] of apiData['t-1'].properties) {
      if (key) headers[`T1_${key}`] = String(value ?? '');
    }
  }

  if (apiData.t?.properties) {
    for (const [, value, key] of apiData.t.properties) {
      if (key) headers[`T_${key}`] = String(value ?? '');
    }
  }

  const keyMap = {
    FundInstrumentID: 'FundInstrumentID',
    SecurityID: 'FundInstrumentID',
    Symbol: 'FundName',
    FundManagementCompany: 'FundCompanyName',
    UnderlyingSecurityID: 'UnderlyingIndex',
    TradingDay: 'TradingDay',
    T1_NAVperCU: 'NAVperCU',
    T1_NAV: 'NAV',
    T1_PreCashComponent: 'PreCashComponent',
    T_PreCashComponent: 'PreCashComponent',
    T_EstimateCashComponent: 'EstimatedCashComponent',
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
    RecordNum: 'RecordNumber',
    TotalRecordNum: 'RecordNumber'
  };

  const normalizedHeaders = {};
  for (const [apiKey, xmlKey] of Object.entries(keyMap)) {
    if (headers[apiKey] !== undefined) normalizedHeaders[xmlKey] = headers[apiKey];
  }
  for (const [k, v] of Object.entries(headers)) {
    if (!Object.keys(keyMap).includes(k)) normalizedHeaders[k] = v;
  }

  const securities = {};
  if (apiData.securities?.rows) {
    const cols = apiData.securities.cols;
    const colMap = {
      '证券ID': 'InstrumentID',
      '证券代码': 'InstrumentID',
      '证券代码源': 'SecurityIDSource',
      '证券简称': 'InstrumentName',
      '该证券数量': 'Quantity',
      '成分证券数': 'Quantity',
      '替代标志': 'SubstitutionFlag',
      '现金替代标志': 'SubstitutionFlag',
      '申购溢价比例': 'CreationPremiumRate',
      '溢价比例': 'CreationPremiumRate',
      '赎回折价比例': 'RedemptionDiscountRate',
      '折价比例': 'RedemptionDiscountRate',
      '替代金额': 'SubstitutionCashAmount',
      '申购替代金额': 'CreationCashSubstitute',
      '赎回替代金额': 'RedemptionCashSubstitute',
      '市场ID': 'UnderlyingSecurityID'
    };
    for (const row of apiData.securities.rows) {
      const id = String(row[0]);
      securities[id] = {};
      cols.forEach((col, i) => {
        const xmlField = colMap[col] || col;
        securities[id][xmlField] = String(row[i] ?? '');
      });
      normalizeSecurityFields(securities[id], { forApi: true });
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
