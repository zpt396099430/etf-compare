const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

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

/**
 * Parse XML file (source A or B) into normalized structure
 * Returns { fundCode, tradingDay, headers: {}, securities: { id: {} } }
 */
function parseXML(xmlContent) {
  const doc = parser.parse(xmlContent);
  const root = doc.SSEPortfolioCompositionFile || doc;

  const headers = {};
  for (const f of HEADER_FIELDS) {
    if (root[f] !== undefined) headers[f] = String(root[f]);
  }

  const securities = {};
  const list = root.ComponentList?.Component;
  if (list) {
    const items = Array.isArray(list) ? list : [list];
    for (const item of items) {
      const id = String(item.InstrumentID);
      securities[id] = {};
      for (const f of SECURITY_FIELDS) {
        if (item[f] !== undefined) securities[id][f] = String(item[f]);
      }
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
    const cols = apiData.securities.cols; // ["证券ID","证券简称","该证券数量","替代标志","申购溢价比例","赎回折价比例","替代金额","市场ID"]
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
