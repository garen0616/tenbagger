import dayjs from "dayjs";
import { Fundamentals, Quarter } from "./types";

type QuarterDatum = {
  value: number;
  end?: string;
  filed?: string;
  start?: string | null;
};

type AnyRecord = Record<string, any>;

type ProviderError = Error & {
  provider?: string;
  recoverable?: boolean;
  reason?: string;
};

const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const SEC_TICKER_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_COMPANY_FACTS_BASE = "https://data.sec.gov/api/xbrl/companyfacts";

const quarterFrameRegex = /^[A-Z]{2}(\d{4})Q([1-4])I$/i;
const allowedForms = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A"]);

let secTickerCache: Map<string, string> | null = null;

function createProviderError(
  provider: string,
  message: string,
  recoverable = false,
  reason?: string,
  cause?: unknown,
): ProviderError {
  const error = new Error(`[${provider}] ${message}`) as ProviderError;
  error.name = `${provider}ProviderError`;
  error.provider = provider;
  error.recoverable = recoverable;
  error.reason = reason;
  if (cause) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (error as any).cause = cause;
  }
  return error;
}

function safeNum(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function firstDefined(record: AnyRecord | undefined, keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (key in record && record[key] !== null && record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function toISODate(value: unknown): string | null {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    const ts = value > 1e12 ? value : value * 1000;
    const d = dayjs(ts);
    return d.isValid() ? d.toISOString() : null;
  }
  if (typeof value === "string") {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.toISOString() : null;
  }
  return null;
}

function ensureQuarter(byDate: Map<string, Quarter>, iso: string): Quarter {
  const existing = byDate.get(iso);
  if (existing) return existing;
  const base: Quarter = {
    period: iso,
    revenue: Number.NaN,
    grossProfit: Number.NaN,
    sga: Number.NaN,
    rnd: Number.NaN,
    ocf: Number.NaN,
    capex: Number.NaN,
    inventory: Number.NaN,
    receivables: Number.NaN,
    cash: Number.NaN,
    totalDebt: Number.NaN,
    dilutedShares: undefined,
    ebitda: Number.NaN,
    netIncome: Number.NaN,
    fiscalYear: undefined,
    fiscalQuarter: undefined,
  };
  byDate.set(iso, base);
  return base;
}

function applyPatch(byDate: Map<string, Quarter>, iso: string | null, patch: Partial<Quarter>) {
  if (!iso) return;
  const quarter = ensureQuarter(byDate, iso);

  if (patch.revenue !== undefined && Number.isFinite(patch.revenue)) {
    quarter.revenue = patch.revenue;
  }
  if (patch.grossProfit !== undefined && Number.isFinite(patch.grossProfit)) {
    quarter.grossProfit = patch.grossProfit;
  }
  if (patch.sga !== undefined && Number.isFinite(patch.sga)) {
    quarter.sga = patch.sga;
  }
  if (patch.rnd !== undefined && Number.isFinite(patch.rnd)) {
    quarter.rnd = patch.rnd;
  }
  if (patch.ocf !== undefined && Number.isFinite(patch.ocf)) {
    quarter.ocf = patch.ocf;
  }
  if (patch.capex !== undefined && Number.isFinite(patch.capex)) {
    quarter.capex = patch.capex;
  }
  if (patch.inventory !== undefined && Number.isFinite(patch.inventory)) {
    quarter.inventory = patch.inventory;
  }
  if (patch.receivables !== undefined && Number.isFinite(patch.receivables)) {
    quarter.receivables = patch.receivables;
  }
  if (patch.cash !== undefined && Number.isFinite(patch.cash)) {
    quarter.cash = patch.cash;
  }
  if (patch.totalDebt !== undefined && Number.isFinite(patch.totalDebt)) {
    quarter.totalDebt = patch.totalDebt;
  }
  if (patch.dilutedShares !== undefined && Number.isFinite(patch.dilutedShares)) {
    quarter.dilutedShares = patch.dilutedShares;
  }
  if (patch.ebitda !== undefined && Number.isFinite(patch.ebitda)) {
    quarter.ebitda = patch.ebitda;
  }
  if (patch.netIncome !== undefined && Number.isFinite(patch.netIncome)) {
    quarter.netIncome = patch.netIncome;
  }
  if (patch.fiscalYear !== undefined) {
    quarter.fiscalYear = patch.fiscalYear;
  }
  if (patch.fiscalQuarter !== undefined) {
    quarter.fiscalQuarter = patch.fiscalQuarter;
  }
}

function getSecUserAgent(): string {
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent || !userAgent.trim()) {
    throw createProviderError("SEC", "SEC_USER_AGENT 未設定。請提供聯絡資訊以呼叫 SEC API。", true, "missing-user-agent");
  }
  return userAgent.trim();
}

async function fetchJsonWithHeaders(url: string | URL, headers: Record<string, string>): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url.toString(), { headers });
  } catch (err) {
    throw createProviderError("SEC", `網路錯誤：${(err as Error).message}`, true, "network", err);
  }

  const status = response.status;
  const text = await response.text();
  let payload: any = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      throw createProviderError("SEC", "無法解析回應 JSON。", true, "parse", err);
    }
  }

  if (status === 429) {
    throw createProviderError("SEC", "SEC API 配額限制 (HTTP 429)。", true, "quota");
  }

  if (status >= 400) {
    throw createProviderError("SEC", `HTTP ${status} ${response.statusText || ""}`.trim(), true, `http-${status}`);
  }

  return payload;
}

async function loadSecTickerCache(): Promise<Map<string, string>> {
  if (secTickerCache) return secTickerCache;
  const userAgent = getSecUserAgent();
  const data = await fetchJsonWithHeaders(SEC_TICKER_URL, {
    "User-Agent": userAgent,
    Accept: "application/json",
  });

  const map = new Map<string, string>();
  if (Array.isArray(data)) {
    for (const entry of data) {
      const ticker = typeof entry?.ticker === "string" ? entry.ticker.toUpperCase() : null;
      const cik = typeof entry?.cik_str === "number" ? entry.cik_str.toString().padStart(10, "0") : null;
      if (ticker && cik) {
        map.set(ticker, cik);
      }
    }
  } else if (data && typeof data === "object") {
    for (const value of Object.values(data as Record<string, any>)) {
      const ticker = typeof value?.ticker === "string" ? value.ticker.toUpperCase() : null;
      const cik = typeof value?.cik_str === "number" ? value.cik_str.toString().padStart(10, "0") : null;
      if (ticker && cik) {
        map.set(ticker, cik);
      }
    }
  }

  if (map.size === 0) {
    throw createProviderError("SEC", "無法載入 SEC 公司代號對照表。", true, "ticker-list-empty");
  }

  secTickerCache = map;
  return map;
}

async function getCikForTicker(ticker: string): Promise<string> {
  const map = await loadSecTickerCache();
  const cik = map.get(ticker);
  if (!cik) {
    throw createProviderError("SEC", `找不到 ${ticker} 的 CIK。`, true, "unknown-ticker");
  }
  return cik;
}

async function fetchCompanyFacts(cik: string): Promise<AnyRecord> {
  const userAgent = getSecUserAgent();
  const url = `${SEC_COMPANY_FACTS_BASE}/CIK${cik}.json`;
  return fetchJsonWithHeaders(url, {
    "User-Agent": userAgent,
    Accept: "application/json",
  });
}

function normalizeValue(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case "usdm":
    case "usdmm":
    case "usd (in millions)":
      return value * 1_000_000;
    case "usdbn":
      return value * 1_000_000_000;
    case "usdth":
    case "usd thousands":
    case "usd (in thousands)":
      return value * 1_000;
    case "sharesm":
    case "shares (in millions)":
      return value * 1_000_000;
    case "usd":
    case "shares":
    default:
      return value;
  }
}

function parseQuarterKey(key: string): { year: number; quarter: number } {
  const match = key.match(/^(\d{4})Q([1-4])$/);
  if (!match) {
    return { year: 0, quarter: 0 };
  }
  return { year: Number(match[1]), quarter: Number(match[2]) };
}

function quarterSortDesc(a: string, b: string) {
  const av = parseQuarterKey(a);
  const bv = parseQuarterKey(b);
  if (av.year === bv.year) return bv.quarter - av.quarter;
  return bv.year - av.year;
}

function quarterSortAsc(a: string, b: string) {
  const av = parseQuarterKey(a);
  const bv = parseQuarterKey(b);
  if (av.year === bv.year) return av.quarter - bv.quarter;
  return av.year - bv.year;
}

function updateQuarterDatum(map: Map<string, QuarterDatum>, key: string, datum: QuarterDatum) {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, datum);
    return;
  }
  const existingFiled = existing.filed ? new Date(existing.filed).getTime() : 0;
  const newFiled = datum.filed ? new Date(datum.filed).getTime() : 0;
  if (newFiled >= existingFiled) {
    map.set(key, datum);
  }
}

type ConceptConfig = {
  taxonomy: string;
  concepts: string[];
  units?: string[];
};

type ExtractOptions = {
  mode: "instant" | "duration";
};

function collectFactSeries(
  facts: AnyRecord,
  configs: ConceptConfig[],
  options: ExtractOptions,
): Map<string, QuarterDatum> {
  const quarterValues = new Map<string, QuarterDatum>();
  const ytdValues = new Map<string, QuarterDatum>();

  const configsToUse = configs.length ? configs : [];

  for (const cfg of configsToUse) {
    const taxonomyFacts = facts?.[cfg.taxonomy];
    if (!taxonomyFacts) continue;
    for (const concept of cfg.concepts) {
      const conceptData = taxonomyFacts?.[concept];
      if (!conceptData?.units) continue;

      const units = conceptData.units as Record<string, any[]>;
      const unitEntries: Array<[string, any[]]> = cfg.units
        ? cfg.units
            .filter((unit) => units[unit])
            .map((unit) => [unit, units[unit]] as [string, any[]])
        : Object.entries(units);

      for (const [unit, entries] of unitEntries) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          const form = entry?.form;
          if (!form || !allowedForms.has(form)) continue;

          const valueRaw = safeNum(entry?.val);
          if (!Number.isFinite(valueRaw)) continue;
          const normalizedValue = normalizeValue(valueRaw as number, unit);
          const end = toISODate(entry?.end);
          if (!end) continue;
          const endDay = dayjs(end);
          if (!endDay.isValid()) continue;
          const startIso = toISODate(entry?.start);
          const startDay = startIso ? dayjs(startIso) : null;
          const durationDays = startDay ? Math.abs(endDay.diff(startDay, "day")) : null;

          let year = typeof entry?.fy === "number" ? Number(entry.fy) : endDay.year();
          let quarter = 0;

          if (typeof entry?.fp === "string" && entry.fp.startsWith("Q")) {
            quarter = Number(entry.fp.substring(1));
          } else if (entry.fp === "FY" || form.startsWith("10-K")) {
            quarter = 4;
          } else {
            quarter = endDay.quarter();
          }

          if (quarter < 1 || quarter > 4) {
            const frame: string | undefined = entry?.frame;
            if (frame && quarterFrameRegex.test(frame)) {
              const match = frame.match(quarterFrameRegex);
              if (match) {
                year = Number(match[1]);
                quarter = Number(match[2]);
              }
            } else {
              quarter = endDay.quarter();
            }
          }

          const key = `${year}Q${quarter}`;
          const filed = entry?.filed ?? endDay.toISOString();
          const datum: QuarterDatum = {
            value: normalizedValue,
            end: endDay.toISOString(),
            filed,
            start: startIso ?? null,
          };

          if (options.mode === "instant") {
            updateQuarterDatum(quarterValues, key, datum);
            continue;
          }

          if (durationDays !== null && durationDays <= 120) {
            updateQuarterDatum(quarterValues, key, datum);
          } else {
            updateQuarterDatum(ytdValues, key, datum);
          }
        }
      }

    }
  }

  if (options.mode === "instant") {
    return quarterValues;
  }

  const result = new Map<string, QuarterDatum>(quarterValues);
  const ytdKeys = Array.from(ytdValues.keys()).sort(quarterSortAsc);

  for (const key of ytdKeys) {
    if (result.has(key)) continue;
    const current = ytdValues.get(key)!;
    const { year, quarter } = parseQuarterKey(key);
    let quarterValue = current.value;

    if (quarter > 1) {
      const prevKey = `${year}Q${quarter - 1}`;
      const prevYtd = ytdValues.get(prevKey) ?? result.get(prevKey);
      if (prevYtd) {
        quarterValue = current.value - prevYtd.value;
      }
    }

    result.set(key, {
      value: quarterValue,
      end: current.end,
      filed: current.filed,
    });
  }

  return result;
}

function buildQuarterRecords(
  revenueSeries: Map<string, QuarterDatum>,
  metricSeries: Record<string, Map<string, QuarterDatum>>, 
): Quarter[] {
  const keys = Array.from(revenueSeries.keys()).sort(quarterSortDesc).slice(0, 16);
  const quarters: Quarter[] = [];

  for (const key of keys) {
    const revDatum = revenueSeries.get(key);
    if (!revDatum || !Number.isFinite(revDatum.value)) continue;
    const { year, quarter } = parseQuarterKey(key);
    const periodEnd = revDatum.end ? dayjs(revDatum.end) : dayjs()
      .year(year)
      .quarter(quarter)
      .endOf("quarter");

    const grossDatum = metricSeries.grossProfit.get(key);
    const sgaDatum = metricSeries.sga.get(key);
    const rndDatum = metricSeries.rnd.get(key);
    const ocfDatum = metricSeries.ocf.get(key);
    const capexDatum = metricSeries.capex.get(key);
    const inventoryDatum = metricSeries.inventory.get(key);
    const receivablesDatum = metricSeries.receivables.get(key);
    const cashDatum = metricSeries.cash?.get(key);
    const debtTotalDatum = metricSeries.debtTotal?.get(key);
    const debtCurrentDatum = metricSeries.debtCurrent?.get(key);
    const debtNoncurrentDatum = metricSeries.debtNoncurrent?.get(key);
    const dilutedDatum = metricSeries.dilutedShares.get(key);
    const ebitdaDatum = metricSeries.ebitda?.get(key);
    const netIncomeDatum = metricSeries.netIncome?.get(key);

    let totalDebtValue = debtTotalDatum?.value ?? Number.NaN;
    const currentDebtValue = debtCurrentDatum?.value ?? Number.NaN;
    const nonCurrentDebtValue = debtNoncurrentDatum?.value ?? Number.NaN;
    if (!Number.isFinite(totalDebtValue)) {
      const hasCurrent = Number.isFinite(currentDebtValue);
      const hasNonCurrent = Number.isFinite(nonCurrentDebtValue);
      if (hasCurrent || hasNonCurrent) {
        totalDebtValue =
          (hasCurrent ? currentDebtValue : 0) + (hasNonCurrent ? nonCurrentDebtValue : 0);
      }
    }

    quarters.push({
      period: periodEnd.toISOString(),
      revenue: revDatum.value,
      grossProfit: grossDatum?.value ?? Number.NaN,
      sga: sgaDatum?.value ?? Number.NaN,
      rnd: rndDatum?.value ?? Number.NaN,
      ocf: ocfDatum?.value ?? Number.NaN,
      capex: capexDatum?.value ?? Number.NaN,
      inventory: inventoryDatum?.value ?? Number.NaN,
      receivables: receivablesDatum?.value ?? Number.NaN,
      cash: cashDatum?.value ?? Number.NaN,
      totalDebt: totalDebtValue,
      ebitda: ebitdaDatum?.value ?? Number.NaN,
      netIncome: netIncomeDatum?.value ?? Number.NaN,
      dilutedShares: dilutedDatum?.value,
      fiscalYear: year,
      fiscalQuarter: quarter,
    });
  }

    return quarters;
}

async function fetchJson(url: URL, provider: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
    });
  } catch (err) {
    throw createProviderError(
      provider,
      `網路錯誤：${(err as Error).message}`,
      true,
      "network",
      err,
    );
  }

  const status = response.status;
  const text = await response.text();
  let payload: any = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      throw createProviderError(provider, "無法解析回應 JSON。", true, "parse", err);
    }
  }

  if (status === 429) {
    throw createProviderError(provider, "API 配額已用盡（HTTP 429）。", true, "quota");
  }

  if (status === 401 || status === 403) {
    throw createProviderError(provider, `授權受限（HTTP ${status}）。`, true, "unauthorized");
  }

  if (status >= 400) {
    throw createProviderError(
      provider,
      `HTTP ${status} ${response.statusText || ""}`.trim(),
      true,
      `http-${status}`,
    );
  }

  return payload;
}

function finalizeQuarters(byDate: Map<string, Quarter>): Quarter[] {
  return Array.from(byDate.values())
    .filter((q) => dayjs(q.period).isValid())
    .sort((a, b) => dayjs(b.period).valueOf() - dayjs(a.period).valueOf())
    .slice(0, 8);
}

async function fetchFromFmp(symbol: string): Promise<Fundamentals> {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    throw createProviderError("FMP", "FMP_API_KEY 未設定，略過 FMP。", true, "missing-key");
  }

  const mergeData = async (endpoint: string) => {
    const url = new URL(`${FMP_BASE}/${endpoint}/${symbol}`);
    url.searchParams.set("period", "quarter");
    url.searchParams.set("limit", "8");
    url.searchParams.set("apikey", key);
    const json = await fetchJson(url, "FMP");

    if (json?.["Error Message"]) {
      throw createProviderError("FMP", json["Error Message"], true, "quota");
    }

    if (!Array.isArray(json)) {
      throw createProviderError("FMP", `意外的資料格式：${endpoint}`, true, "invalid-format");
    }

    return json as AnyRecord[];
  };

  const [income, balance, cashflow, quote] = await Promise.all([
    mergeData("income-statement"),
    mergeData("balance-sheet-statement"),
    mergeData("cash-flow-statement"),
    (async () => {
      const url = new URL(`${FMP_BASE}/quote/${symbol}`);
      url.searchParams.set("apikey", key);
      const json = await fetchJson(url, "FMP");
      if (json?.["Error Message"]) {
        throw createProviderError("FMP", json["Error Message"], true, "quota");
      }
      if (Array.isArray(json)) return json;
      throw createProviderError("FMP", "意外的市值資料格式。", true, "invalid-format");
    })(),
  ]);

  const byDate = new Map<string, Quarter>();

  for (const row of income) {
    const iso = toISODate(firstDefined(row, ["date", "period", "reportDate", "fillingDate"]));
    applyPatch(byDate, iso, {
      revenue: safeNum(firstDefined(row, ["revenue", "totalRevenue"])),
      grossProfit: safeNum(row.grossProfit),
      sga: safeNum(
        firstDefined(row, [
          "sellingGeneralAdministrative",
          "sellingGeneralAdministrativeExpenses",
          "otherSellingGeneralAdministrative",
        ]),
      ),
      ebitda: safeNum(firstDefined(row, ["ebitda", "EBITDA"])),
      netIncome: safeNum(firstDefined(row, ["netIncome", "netIncomeIncomeTaxExpense"])),
      rnd: safeNum(firstDefined(row, ["researchAndDevelopment", "researchAndDevelopmentExpenses"])),
      dilutedShares: safeNum(
        firstDefined(row, [
          "weightedAverageShsOutDil",
          "weightedAverageShsOutDiluted",
          "weightedAverageShsOut",
        ]),
      ),
    });
  }

  for (const row of cashflow) {
    const iso = toISODate(firstDefined(row, ["date", "period", "reportDate", "fillingDate"]));
    const ocf = safeNum(
      firstDefined(row, [
        "netCashProvidedByOperatingActivities",
        "netCashProvidedByOperatingActivitiesContinuingOperations",
        "netCashProvidedByOperatingActivitiesDirect",
      ]),
    );
    let capex = safeNum(
      firstDefined(row, ["capitalExpenditure", "capitalExpenditures", "capitalExpenditureReported"]),
    );
    if (capex !== undefined) {
      capex = Math.abs(capex);
    }
    applyPatch(byDate, iso, { ocf, capex });
  }

  for (const row of balance) {
    const iso = toISODate(firstDefined(row, ["date", "period", "reportDate", "fillingDate"]));
    applyPatch(byDate, iso, {
      inventory: safeNum(firstDefined(row, ["inventory", "inventoryAndOtherCurrentAssets"])),
      receivables: safeNum(
        firstDefined(row, ["netReceivables", "accountsReceivables", "accountsReceivable"]),
      ),
      cash: safeNum(
        firstDefined(row, [
          "cashAndCashEquivalents",
          "cashAndCashEquivalentsAndShortTermInvestments",
          "cashAndEquivalents",
        ]),
      ),
      totalDebt: safeNum(
        firstDefined(row, [
          "totalDebt",
          "totalDebtAndLeaseObligation",
          "totalDebtAndCapitalLeaseObligation",
        ]),
      ),
    });
  }

  const quarters = finalizeQuarters(byDate);
  const marketCap = safeNum(firstDefined(quote?.[0], ["marketCap", "mktCap"]));

  if (marketCap === undefined || !Number.isFinite(marketCap)) {
    throw createProviderError("FMP", "取得市值失敗。", true, "missing-market-cap");
  }

  if (quarters.length < 4) {
    throw createProviderError("FMP", "回傳財報不足四季。", true, "insufficient-data");
  }

  return { ticker: symbol, marketCap, quarters };
}

function extractConcept(section: AnyRecord[] | undefined, concepts: string[]): number | undefined {
  if (!Array.isArray(section)) return undefined;
  for (const concept of concepts) {
    const match = section.find((item) => item?.concept === concept);
    if (!match) continue;
    const value = safeNum(match.value);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

async function fetchFinnhubReports(symbol: string, token: string): Promise<AnyRecord[]> {
  const url = new URL(`${FINNHUB_BASE}/stock/financials-reported`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("freq", "quarterly");
  url.searchParams.set("token", token);
  const json = await fetchJson(url, "Finnhub");
  if (json?.error) {
    throw createProviderError("Finnhub", json.error, true, "quota");
  }
  if (!Array.isArray(json?.data)) {
    throw createProviderError("Finnhub", "意外的財報資料格式。", true, "invalid-format");
  }
  return json.data as AnyRecord[];
}

async function fetchFinnhubProfile(symbol: string, token: string): Promise<AnyRecord> {
  const url = new URL(`${FINNHUB_BASE}/stock/profile2`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", token);
  const json = await fetchJson(url, "Finnhub");
  if (json?.error) {
    throw createProviderError("Finnhub", json.error, true, "quota");
  }
  if (!json || typeof json !== "object") {
    throw createProviderError("Finnhub", "意外的公司資料格式。", true, "invalid-format");
  }
  return json;
}

async function fetchFromSec(symbol: string): Promise<Fundamentals> {
  const cik = await getCikForTicker(symbol);
  const cikPadded = cik.padStart(10, "0");
  const factsResponse = await fetchCompanyFacts(cikPadded);
  const companyFacts = factsResponse?.facts;

  if (!companyFacts) {
    throw createProviderError("SEC", "無法取得公司財報資料。", true, "empty-facts");
  }

  const revenueSeries = collectFactSeries(
    companyFacts,
    [
      {
        taxonomy: "us-gaap",
        concepts: [
          "Revenues",
          "SalesRevenueNet",
          "RevenueFromContractWithCustomerExcludingAssessedTax",
        ],
        units: ["USD", "USDm", "USDth"],
      },
    ],
    { mode: "duration" },
  );

  if (revenueSeries.size === 0) {
    throw createProviderError("SEC", "未找到季度營收資料。", true, "missing-revenue");
  }

  const metricSeries = {
    grossProfit: collectFactSeries(
      companyFacts,
      [{ taxonomy: "us-gaap", concepts: ["GrossProfit"], units: ["USD", "USDm", "USDth"] }],
      { mode: "duration" },
    ),
    sga: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: ["SellingGeneralAndAdministrativeExpense", "SellingGeneralAndAdministrativeExpenseValueAdded"],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "duration" },
    ),
    rnd: collectFactSeries(
      companyFacts,
      [{ taxonomy: "us-gaap", concepts: ["ResearchAndDevelopmentExpense"], units: ["USD", "USDm", "USDth"] }],
      { mode: "duration" },
    ),
    ocf: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: [
          "NetCashProvidedByUsedInOperatingActivities",
          "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
        ],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "duration" },
    ),
    capex: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: [
          "PaymentsToAcquirePropertyPlantAndEquipment",
          "CapitalExpenditures",
          "PurchaseOfFixedAssets",
        ],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "duration" },
    ),
    inventory: collectFactSeries(
      companyFacts,
      [{ taxonomy: "us-gaap", concepts: ["InventoryNet"], units: ["USD", "USDm", "USDth"] }],
      { mode: "instant" },
    ),
    receivables: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: ["AccountsReceivableNetCurrent", "AccountsReceivableNet", "AccountsAndNotesReceivableNetCurrent"],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "instant" },
    ),
    ebitda: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: [
          "EarningsBeforeInterestTaxesDepreciationAndAmortization",
          "EarningsBeforeInterestAheadOfDiscontinuedOperationsIncomeLoss",
        ],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "duration" },
    ),
    netIncome: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: ["NetIncomeLoss", "ProfitLoss"],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "duration" },
    ),
    cash: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: [
          "CashAndCashEquivalentsAtCarryingValue",
          "CashAndCashEquivalents",
          "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
        ],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "instant" },
    ),
    debtTotal: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: [
          "Debt",
          "DebtInstrumentCarryingAmount",
          "DebtAndCapitalLeaseObligations",
          "LongTermDebtAndCapitalLeaseObligations",
        ],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "instant" },
    ),
    debtCurrent: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: [
          "DebtCurrent",
          "ShortTermBorrowings",
          "CommercialPaper",
        ],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "instant" },
    ),
    debtNoncurrent: collectFactSeries(
      companyFacts,
      [{
        taxonomy: "us-gaap",
        concepts: [
          "LongTermDebtNoncurrent",
          "LongTermDebt",
          "NotesPayableNoncurrent",
        ],
        units: ["USD", "USDm", "USDth"],
      }],
      { mode: "instant" },
    ),
    dilutedShares: collectFactSeries(
      companyFacts,
      [
        {
          taxonomy: "dei",
          concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
          units: ["shares", "sharesm"],
        },
        {
          taxonomy: "us-gaap",
          concepts: [
            "WeightedAverageNumberOfDilutedSharesOutstanding",
            "WeightedAverageNumberOfSharesOutstandingDiluted",
          ],
          units: ["shares", "sharesm"],
        },
      ],
      { mode: "duration" },
    ),
  };

  const quarters = buildQuarterRecords(revenueSeries, metricSeries).slice(0, 12);
  const validQuarters = quarters.filter((item) => Number.isFinite(item.revenue)).slice(0, 12);

  if (validQuarters.length < 8) {
    throw createProviderError("SEC", "SEC 財報不足八季。", true, "insufficient-data");
  }
  const needsSupplement = validQuarters.some(
    (item) => !Number.isFinite(item.capex) || !Number.isFinite(item.ocf),
  );
  let marketCap: number | undefined;

  const finnhubToken = process.env.FINNHUB_API_KEY;
  if (!finnhubToken) {
    throw createProviderError("SEC", "FINNHUB_API_KEY 未設定，無法取得市值。", true, "missing-marketcap");
  }

  let finnhubFallback: Fundamentals | null = null;
  try {
    const profile = await fetchFinnhubProfile(symbol, finnhubToken);
    marketCap = safeNum(profile?.marketCapitalization);
    if (marketCap !== undefined) {
      marketCap *= 1_000_000;
    } else {
      const marketCapMln = safeNum(profile?.marketCapitalizationMln);
      if (marketCapMln !== undefined) {
        marketCap = marketCapMln * 1_000_000;
      }
    }

    if (needsSupplement) {
      try {
        finnhubFallback = await fetchFromFinnhub(symbol);
      } catch (err) {
        console.warn(
          `[fetchFundamentals][SEC] Finnhub 補值失敗：${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    throw createProviderError("SEC", "無法從 Finnhub 取得市值。", true, "missing-marketcap", err);
  }

  if (marketCap === undefined || !Number.isFinite(marketCap)) {
    throw createProviderError("SEC", "無法從 Finnhub 取得市值。", true, "missing-marketcap");
  }

  if (finnhubFallback && needsSupplement) {
    const finnhubMap = new Map<string, Quarter>();
    for (const q of finnhubFallback.quarters) {
      const key = `${dayjs(q.period).year()}Q${dayjs(q.period).quarter()}`;
      finnhubMap.set(key, q);
    }

    for (const quarter of validQuarters) {
      const key = `${dayjs(quarter.period).year()}Q${dayjs(quarter.period).quarter()}`;
      const fallbackQuarter = finnhubMap.get(key);
      if (fallbackQuarter) {
        if (!Number.isFinite(quarter.capex) && Number.isFinite(fallbackQuarter.capex)) {
          quarter.capex = Math.abs(fallbackQuarter.capex);
        }
        if (!Number.isFinite(quarter.ocf) && Number.isFinite(fallbackQuarter.ocf)) {
          quarter.ocf = fallbackQuarter.ocf;
        }
      }
    }
  }

  return {
    ticker: symbol,
    marketCap,
    quarters: validQuarters,
  };
}

async function fetchFromFinnhub(symbol: string): Promise<Fundamentals> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) {
    throw createProviderError("Finnhub", "FINNHUB_API_KEY 未設定，略過 Finnhub。", true, "missing-key");
  }

  const [reports, profile] = await Promise.all([
    fetchFinnhubReports(symbol, token),
    fetchFinnhubProfile(symbol, token),
  ]);

  const byDate = new Map<string, Quarter>();

  for (const report of reports) {
    if (report?.form && report.form !== "10-Q") continue;
    const iso = toISODate(report?.endDate ?? report?.reportDate ?? report?.period);
    if (!iso) continue;
    const sections = report?.report ?? {};
    const ic = Array.isArray(sections?.ic) ? (sections.ic as AnyRecord[]) : undefined;
    const bs = Array.isArray(sections?.bs) ? (sections.bs as AnyRecord[]) : undefined;
    const cf = Array.isArray(sections?.cf) ? (sections.cf as AnyRecord[]) : undefined;
    const fiscalYear = typeof report?.year === "number" ? report.year : undefined;
    const fiscalQuarter = typeof report?.quarter === "number" ? report.quarter : undefined;

    const revenue = extractConcept(ic, [
      "us-gaap_Revenues",
      "us-gaap_SalesRevenueNet",
    ]);
    const grossProfit = extractConcept(ic, [
      "us-gaap_GrossProfit",
    ]);
    const sga = extractConcept(ic, [
      "us-gaap_SellingGeneralAndAdministrativeExpense",
      "us-gaap_SellingGeneralAndAdministrativeExpenseValueAdded",
    ]);
    const rnd = extractConcept(ic, [
      "us-gaap_ResearchAndDevelopmentExpense",
      "us-gaap_ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
    ]);
    const ebitda = extractConcept(ic, [
      "us-gaap_EarningsBeforeInterestTaxesDepreciationAndAmortization",
      "us-gaap_EarningsBeforeInterestAndTaxes",
    ]);
    const netIncome = extractConcept(ic, [
      "us-gaap_NetIncomeLoss",
      "us-gaap_ProfitLoss",
    ]);
    const dilutedShares = extractConcept(ic, [
      "us-gaap_WeightedAverageNumberOfDilutedSharesOutstanding",
      "us-gaap_WeightedAverageNumberOfDilutedSharesOutstandingRestated",
      "us-gaap_WeightedAverageNumberOfDilutedSharesOutstandingCorrectionOfAnErrorInPreviouslyIssuedFinancialStatements",
    ]);

    const ocf = extractConcept(cf, [
      "us-gaap_NetCashProvidedByUsedInOperatingActivities",
      "us-gaap_NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ]);

    let capex = extractConcept(cf, [
      "us-gaap_PaymentsToAcquirePropertyPlantAndEquipment",
      "us-gaap_PaymentsToAcquireProductiveAssets",
      "us-gaap_PurchaseOfFixedAssets",
    ]);
    if (capex !== undefined) {
      capex = Math.abs(capex);
    }

    const inventory = extractConcept(bs, [
      "us-gaap_InventoryNet",
      "us-gaap_InventoriesNet",
    ]);
    const receivables = extractConcept(bs, [
      "us-gaap_AccountsReceivableNetCurrent",
      "us-gaap_AccountsReceivableNet",
      "us-gaap_AccountsAndNotesReceivableNetCurrent",
    ]);
    const cash = extractConcept(bs, [
      "us-gaap_CashAndCashEquivalentsAtCarryingValue",
      "us-gaap_CashAndCashEquivalents",
      "us-gaap_CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ]);
    let totalDebt = extractConcept(bs, [
      "us-gaap_DebtAndCapitalLeaseObligations",
      "us-gaap_Debt",
      "us-gaap_DebtInstrumentCarryingAmount",
      "us-gaap_LongTermDebtAndCapitalLeaseObligations",
    ]);
    const debtCurrent = extractConcept(bs, [
      "us-gaap_DebtCurrent",
      "us-gaap_ShortTermBorrowings",
      "us-gaap_CommercialPaper",
    ]);
    const debtNoncurrent = extractConcept(bs, [
      "us-gaap_LongTermDebtNoncurrent",
      "us-gaap_LongTermDebt",
      "us-gaap_NotesPayableNoncurrent",
    ]);
    if (totalDebt === undefined) {
      const hasDebtCurrent = typeof debtCurrent === "number" && Number.isFinite(debtCurrent);
      const hasDebtNoncurrent = typeof debtNoncurrent === "number" && Number.isFinite(debtNoncurrent);
      if (hasDebtCurrent || hasDebtNoncurrent) {
        totalDebt = (hasDebtCurrent ? (debtCurrent as number) : 0) +
          (hasDebtNoncurrent ? (debtNoncurrent as number) : 0);
      }
    }

    applyPatch(byDate, iso, {
      revenue,
      grossProfit,
      sga,
      rnd,
      dilutedShares,
      ocf,
      capex,
      inventory,
      receivables,
      ebitda,
      netIncome,
      cash,
      totalDebt,
      fiscalYear,
      fiscalQuarter,
    });
  }

  const quarters = finalizeQuarters(byDate);
  let marketCap = safeNum(firstDefined(profile, ["marketCapitalization"]));
  if (marketCap !== undefined) {
    marketCap = marketCap * 1_000_000;
  }
  if (marketCap === undefined) {
    const marketCapMln = safeNum(profile?.marketCapitalizationMln);
    if (marketCapMln !== undefined) {
      marketCap = marketCapMln * 1_000_000;
    }
  }

  if (marketCap === undefined || !Number.isFinite(marketCap)) {
    throw createProviderError("Finnhub", "取得市值失敗。", true, "missing-market-cap");
  }

  if (quarters.length < 4) {
    throw createProviderError("Finnhub", "回傳財報不足四季。", true, "insufficient-data");
  }

  return { ticker: symbol, marketCap, quarters };
}

export async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  const symbol = ticker.toUpperCase();
  const errors: string[] = [];

  const providers: Array<{
    name: string;
    handler: (symbol: string) => Promise<Fundamentals>;
  }> = [
    { name: "SEC", handler: fetchFromSec },
    { name: "FMP", handler: fetchFromFmp },
    { name: "Finnhub", handler: fetchFromFinnhub },
  ];

  for (const provider of providers) {
    try {
      return await provider.handler(symbol);
    } catch (err) {
      const pErr = err as ProviderError;
      const message = pErr?.message ?? (err as Error).message;
      console.warn(`[fetchFundamentals] ${message}`);
      errors.push(message);
      if (!pErr?.recoverable) {
        throw err;
      }
    }
  }

  const aggregate = errors.length
    ? `所有外部財報來源皆失敗：${errors.join("｜")}`
    : "所有外部財報來源皆失敗。";
  throw createProviderError("DATA", aggregate, false, "exhausted");
}
