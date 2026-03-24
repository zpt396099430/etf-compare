const FIELD_LABELS = {
  FundInstrumentID: '基金代码',
  CreationRedemptionUnit: '最小申购赎回单位(份)',
  TradingDay: '交易日',
  PreTradingDay: '前交易日',
  NAVperCU: '最小申购赎回单位资产净值(元)',
  NAV: '基金份额净值(元)',
  PreCashComponent: '现金差额(元)',
  EstimatedCashComponent: '预估现金差额(元)',
  MaxCashRatio: '现金替代比例上限',
  CreationLimit: '当日累计可申购上限(份)',
  RedemptionLimit: '当日累计可赎回上限(份)',
  NetCreationLimit: '当日净申购上限(份)',
  NetRedemptionLimit: '当日净赎回上限(份)',
  NetCreationLimitPerUser: '单账户净申购上限(份)',
  NetRedemptionLimitPerUser: '单账户净赎回上限(份)',
  CreationLimitPerUser: '单账户累计申购上限(份)',
  RedemptionLimitPerUser: '单账户累计赎回上限(份)',
  PublishIOPVFlag: '是否公布IOPV',
  CreationRedemptionSwitch: '申购赎回允许情况',
  CreationRedemptionMechanism: '申购赎回模式',
  RecordNumber: '成分股数量',
  FundName: '基金名称',
  FundCompanyName: '基金公司名称',
  UnderlyingIndex: '标的指数代码',
  // Security fields
  InstrumentID: '证券代码',
  InstrumentName: '证券名称',
  Quantity: '数量',
  SecurityIDSource: '证券代码源',
  SubstitutionFlag: '替代标志',
  CreationPremiumRate: '申购溢价比例',
  RedemptionDiscountRate: '赎回折价比例',
  SubstitutionCashAmount: '替代金额',
  CreationCashSubstitute: '申购替代金额',
  RedemptionCashSubstitute: '赎回替代金额',
  UnderlyingSecurityID: '市场ID',
};

const SECURITY_DISPLAY_FIELDS = [
  'SecurityIDSource',
  'Quantity',
  'SubstitutionFlag',
  'CreationPremiumRate',
  'RedemptionDiscountRate',
  'CreationCashSubstitute',
  'RedemptionCashSubstitute',
  'SubstitutionCashAmount',
  'UnderlyingSecurityID'
];

const DEFAULT_MAPPINGS = {
  SubstitutionFlag: { '1': '允许', '0': '不允许', '2': '必须' },
  PublishIOPVFlag: { '1': '是', '0': '否' },
  CreationRedemptionSwitch: { '1': '申购和赎回皆允许', '0': '暂停申购和赎回', '2': '暂停申购', '3': '暂停赎回' },
  CreationRedemptionMechanism: { '1': '沪市成分证券实物对价', '2': '深市成分证券实物对价', '3': '沪深成分证券实物对价' },
};

module.exports = { FIELD_LABELS, SECURITY_DISPLAY_FIELDS, DEFAULT_MAPPINGS };
