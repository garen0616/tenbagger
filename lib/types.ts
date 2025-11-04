export interface Quarter {
  period: string;            // ISO 日期，最新在前
  revenue: number;           // totalRevenue
  grossProfit: number;       // grossProfit
  sga: number;               // sellingGeneralAdministrative
  rnd: number;               // researchDevelopment
  ocf: number;               // totalCashFromOperatingActivities
  capex: number;             // capitalExpenditures (以正值表示投資支出)
  inventory: number;         // inventory
  receivables: number;       // accounts/net receivables
  cash?: number;             // cash and cash equivalents
  totalDebt?: number;        // total debt (短+長)
  dilutedShares?: number;    // dilutedAverageShares（若缺，可能無法判定#9）
  ebitda?: number;           // EBITDA
  netIncome?: number;        // Net income
  fiscalYear?: number;       // optional fiscal year (若資料源提供)
  fiscalQuarter?: number;    // optional fiscal quarter (1~4)
}

export interface Fundamentals {
  ticker: string;
  marketCap: number;
  quarters: Quarter[];       // 需要至少 8 季，最新在前
}
