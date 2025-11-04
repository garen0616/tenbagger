import dayjs from "dayjs";
import quarterOfYear from "dayjs/plugin/quarterOfYear";
import { Fundamentals, Quarter } from "./types";

dayjs.extend(quarterOfYear);

function sum(arr: number[]) { return arr.reduce((a,b)=>a+(Number.isFinite(b)?b:0),0); }
function avg(arr: number[]) { return arr.length? sum(arr)/arr.length : 0; }
function avgValid(arr: number[]) {
  const valid = arr.filter(Number.isFinite);
  return valid.length ? sum(valid) / valid.length : Number.NaN;
}
function hasFinite(arr: number[], expectedLength: number) {
  return arr.length === expectedLength && arr.every(Number.isFinite);
}
function safeDiv(a:number,b:number){ return b===0? 0 : a/b; }

const compactNumber = new Intl.NumberFormat("zh-TW", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const compactCurrency = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function fmtNumber(value: number) {
  return Number.isFinite(value) ? compactNumber.format(value) : "無資料";
}

function fmtCurrency(value: number) {
  return Number.isFinite(value) ? compactCurrency.format(value) : "無資料";
}

function fmtPercent(value: number) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "無資料";
}

function normalizeShares(series: number[]): number[] {
  const normalized: number[] = [];
  let factor = 1;
  let prevRaw: number | null = null;

  for (const raw of series) {
    if (!Number.isFinite(raw) || raw <= 0) {
      normalized.push(Number.NaN);
      prevRaw = null;
      continue;
    }

    if (prevRaw !== null && Number.isFinite(prevRaw) && prevRaw > 0) {
      const ratio = prevRaw / raw;
      if (ratio > 4.5 && ratio < 11.5) {
        factor *= ratio;
      } else if (ratio < 0.22 && ratio > 0.08) {
        factor *= ratio;
      }
    }

    normalized.push(raw * factor);
    prevRaw = raw;
  }

  return normalized;
}

function toCalendarQuarterLabel(period: string) {
  const d = dayjs(period);
  if (!d.isValid()) return period;
  return `${d.year()}Q${d.quarter()}`;
}

function getQuarterLabel(quarter: Quarter) {
  if (
    typeof quarter.fiscalYear === "number" &&
    typeof quarter.fiscalQuarter === "number" &&
    quarter.fiscalQuarter >= 1 &&
    quarter.fiscalQuarter <= 4
  ) {
    return `${quarter.fiscalYear}Q${quarter.fiscalQuarter}`;
  }
  return toCalendarQuarterLabel(quarter.period);
}

export function scoreCompany(f: Fundamentals) {
  const sorted = [...f.quarters].sort(
    (a, b) => dayjs(b.period).valueOf() - dayjs(a.period).valueOf(),
  );
  const today = dayjs();
  const usable = sorted.filter((qr) => !dayjs(qr.period).isAfter(today));
  const base = usable.length >= 4 ? usable : sorted;
  const latestKnown = base[0] ?? sorted[0];
  const anchorMoment = dayjs(latestKnown?.period ?? today).endOf("quarter");

  const labelMap = new Map<string, Quarter>();
  for (const record of base) {
    const calLabel = toCalendarQuarterLabel(record.period);
    if (!labelMap.has(calLabel)) {
      labelMap.set(calLabel, record);
    }
  }

  const timeline: Array<{ label: string; quarter: Quarter; hasData: boolean }> = [];
  const MAX_TIMELINE = 16;
  let cursor = anchorMoment;

  for (let i = 0; i < MAX_TIMELINE; i += 1) {
    const label = `${cursor.year()}Q${cursor.quarter()}`;
    const existing = labelMap.get(label);
    const quarter = existing
      ? { ...existing, fiscalYear: existing.fiscalYear ?? cursor.year(), fiscalQuarter: existing.fiscalQuarter ?? cursor.quarter() }
      : {
          period: cursor.toISOString(),
          revenue: Number.NaN,
          grossProfit: Number.NaN,
          sga: Number.NaN,
          rnd: Number.NaN,
          ocf: Number.NaN,
          capex: Number.NaN,
          inventory: Number.NaN,
          receivables: Number.NaN,
          dilutedShares: undefined,
          fiscalYear: cursor.year(),
          fiscalQuarter: cursor.quarter(),
        };

    timeline.push({ label, quarter, hasData: Boolean(existing) });
    cursor = cursor.subtract(1, "quarter");
  }

  const timelineQuarters = timeline.map((entry) => entry.quarter);
  const latest4 = timelineQuarters.slice(0, 4);
  const earlier4 = timelineQuarters.slice(4, 8);
  const latest2 = latest4.slice(0, 2);
  const earlier2 = latest4.slice(2, 4);
  const revenueSeries = timeline.slice(0, 8).map((item) => ({
    label: item.label,
    revenue: Number.isFinite(item.quarter.revenue) ? item.quarter.revenue : null,
  }));
  const cagrLatestLabels = timeline.slice(0, 4).map((entry) => entry.label);
  const cagrPreviousLabels = timeline.slice(4, 8).map((entry) => entry.label);

  // --- 衍生欄 ---
  const revenueLatest = latest4.map((x) => x.revenue);
  const revenueEarlier = earlier4.map((x) => x.revenue);
  const hasRevenueLatest = latest4.length === 4 && revenueLatest.every(Number.isFinite);
  const hasRevenueEarlier = earlier4.length === 4 && revenueEarlier.every(Number.isFinite);
  const revL4 = hasRevenueLatest ? sum(revenueLatest) : Number.NaN;
  const revP4 = hasRevenueEarlier ? sum(revenueEarlier) : Number.NaN;
  const hasCagrData = hasRevenueLatest && hasRevenueEarlier && revP4 > 0;
  const cagr1y = hasCagrData ? safeDiv(revL4, revP4) - 1 : Number.NaN;

  const gmLatest = latest4.map((x) =>
    Number.isFinite(x.grossProfit) && Number.isFinite(x.revenue) && x.revenue !== 0
      ? safeDiv(x.grossProfit, x.revenue)
      : Number.NaN
  );
  const gmL4 = avgValid(gmLatest);
  const gmQ = timelineQuarters.map((x) =>
    Number.isFinite(x.grossProfit) && Number.isFinite(x.revenue) && x.revenue !== 0
      ? safeDiv(x.grossProfit, x.revenue)
      : Number.NaN
  );
  const grossProfitValues = latest4.map((x) => x.grossProfit);
  const hasGrossProfitTotals =
    latest4.length === 4 && grossProfitValues.every(Number.isFinite);
  const gpL4 = hasGrossProfitTotals ? sum(grossProfitValues) : Number.NaN;
  const gmBaseline = avgValid(gmLatest.slice(1, 4));
  const gmTrend = Number.isFinite(gmLatest[0]) && Number.isFinite(gmBaseline)
    ? gmLatest[0] > gmBaseline
    : null;
  const gmOkForCapex =
    Number.isFinite(gmL4) &&
    Number.isFinite(gmBaseline) &&
    Number.isFinite(gmQ[0]) &&
    gmL4 >= 0.45 &&
    gmQ[0] >= gmBaseline;

  const ocfValues = latest4.map((x) => x.ocf);
  const ocfNear = latest2.map((x) => x.ocf);
  const ocfPrev = earlier2.map((x) => x.ocf);
  const hasOcfTotals = latest4.length === 4 && ocfValues.every(Number.isFinite);
  const hasOcfTrend =
    latest2.length === 2 &&
    earlier2.length === 2 &&
    ocfNear.every(Number.isFinite) &&
    ocfPrev.every(Number.isFinite);
  const ocfL4 = hasOcfTotals ? sum(ocfValues) : Number.NaN;
  const ocfN2 = hasOcfTrend ? sum(ocfNear) : Number.NaN;
  const ocfP2 = hasOcfTrend ? sum(ocfPrev) : Number.NaN;

  const opexNear = latest2.map((x) =>
    Number.isFinite(x.revenue) &&
    x.revenue !== 0 &&
    Number.isFinite(x.sga) &&
    Number.isFinite(x.rnd)
      ? safeDiv((x.sga ?? 0) + (x.rnd ?? 0), x.revenue)
      : Number.NaN
  );
  const opexPrev = earlier2.map((x) =>
    Number.isFinite(x.revenue) &&
    x.revenue !== 0 &&
    Number.isFinite(x.sga) &&
    Number.isFinite(x.rnd)
      ? safeDiv((x.sga ?? 0) + (x.rnd ?? 0), x.revenue)
      : Number.NaN
  );
  const hasOpexData =
    opexNear.length === 2 &&
    opexPrev.length === 2 &&
    opexNear.every(Number.isFinite) &&
    opexPrev.every(Number.isFinite);
  const opexN2 = hasOpexData ? avgValid(opexNear) : Number.NaN;
  const opexP2 = hasOpexData ? avgValid(opexPrev) : Number.NaN;

  const yoyRaw = latest4.map((current, idx) => {
    const prev = timelineQuarters[idx + 4];
    if (
      !prev ||
      !Number.isFinite(current.revenue) ||
      !Number.isFinite(prev.revenue) ||
      prev.revenue === 0
    ) {
      return Number.NaN;
    }
    return safeDiv(current.revenue, prev.revenue) - 1;
  });
  const yoyNear = yoyRaw.slice(0, 2);
  const yoyPrev = yoyRaw.slice(2, 4);
  const hasYoyData =
    yoyNear.length === 2 &&
    yoyPrev.length === 2 &&
    yoyNear.every(Number.isFinite) &&
    yoyPrev.every(Number.isFinite);
  const yoyN2 = hasYoyData ? avgValid(yoyNear) : Number.NaN;
  const yoyP2 = hasYoyData ? avgValid(yoyPrev) : Number.NaN;
  const yoyDelta = hasYoyData ? yoyN2 - yoyP2 : Number.NaN;

  const ps =
    hasRevenueLatest && revL4 > 0
      ? safeDiv(f.marketCap, revL4)
      : Number.NaN;
  const latestCash = latest4[0]?.cash;
  const latestDebt = latest4[0]?.totalDebt;
  let enterpriseValue = Number.NaN;
  if (Number.isFinite(f.marketCap)) {
    enterpriseValue = f.marketCap;
    if (typeof latestDebt === "number" && Number.isFinite(latestDebt)) {
      enterpriseValue += latestDebt;
    }
    if (typeof latestCash === "number" && Number.isFinite(latestCash)) {
      enterpriseValue -= latestCash;
    }
  }
  const ebitdaValues = latest4.map((x) =>
    Number.isFinite(x.ebitda) ? Number(x.ebitda) : Number.NaN
  );
  const ebitdaValid = ebitdaValues.filter(Number.isFinite) as number[];
  const ebitdaL4 = ebitdaValid.length ? sum(ebitdaValid) : Number.NaN;
  const evToEbitda =
    Number.isFinite(enterpriseValue) && Number.isFinite(ebitdaL4) && ebitdaL4 > 0
      ? enterpriseValue / ebitdaL4
      : Number.NaN;

  const capexValues = latest4.map((x) => x.capex);
  const capexBaseline = avgValid(capexValues.slice(1, 4));
  const capexTrend =
    Number.isFinite(capexValues[0]) && Number.isFinite(capexBaseline)
      ? capexValues[0] > capexBaseline
      : null;

  const fcfValues = latest4.map((x, idx) => {
    const ocf = ocfValues[idx];
    const capex = capexValues[idx];
    return Number.isFinite(ocf) && Number.isFinite(capex) ? ocf - capex : Number.NaN;
  });
  const fcfValid = fcfValues.filter(Number.isFinite) as number[];
  const hasFcfData = fcfValid.length >= 3;
  const fcfL4 = fcfValid.length ? sum(fcfValid) : Number.NaN;
  const fcfRevenueDenom = latest4.reduce((acc, q, idx) => {
    const fcf = fcfValues[idx];
    if (Number.isFinite(fcf) && Number.isFinite(q.revenue)) {
      return acc + (q.revenue as number);
    }
    return acc;
  }, 0);
  const fcfCoverage =
    hasFcfData && fcfRevenueDenom > 0 ? fcfL4 / fcfRevenueDenom : Number.NaN;
  const revenueGrowing = Number.isFinite(cagr1y) && cagr1y >= 0.1;
  let fcfPass: boolean | null = null;
  if (fcfValid.length >= 2) {
    if (revenueGrowing) {
      fcfPass = Number.isFinite(fcfL4) ? fcfL4 > 0 : null;
    } else if (Number.isFinite(fcfCoverage)) {
      fcfPass = fcfL4 > 0 || fcfCoverage >= 0.05;
    } else {
      fcfPass = Number.isFinite(fcfL4) ? fcfL4 > 0 : null;
    }
  }

  const evToFcf =
    Number.isFinite(enterpriseValue) && Number.isFinite(fcfL4) && fcfL4 > 0
      ? enterpriseValue / fcfL4
      : Number.NaN;

  const rdRatios = latest4.map((x) =>
    Number.isFinite(x.revenue) && x.revenue !== 0 && Number.isFinite(x.rnd)
      ? safeDiv(x.rnd, x.revenue)
      : Number.NaN
  );
  const rdRate = avgValid(rdRatios);

  const rawDilutedSeries = timelineQuarters.map((x) =>
    Number.isFinite(x.dilutedShares) ? Number(x.dilutedShares) : Number.NaN
  );
  const normalizedDiluted = normalizeShares(rawDilutedSeries);
  const dilutedLatest = normalizedDiluted.slice(0, 4);
  const dilutedPrev = normalizedDiluted.slice(4, 8);
  const dilutedL4 = avgValid(dilutedLatest);
  const dilutedP4 = avgValid(dilutedPrev);
  const hasDilutionData =
    Number.isFinite(dilutedL4) &&
    Number.isFinite(dilutedP4) &&
    dilutedLatest.filter(Number.isFinite).length >= 2 &&
    dilutedPrev.filter(Number.isFinite).length >= 2;
  const dilutionYoY =
    hasDilutionData && dilutedP4 !== 0
      ? dilutedL4 / dilutedP4 - 1
      : null;

  const netIncomeLatest = latest4.map((x) =>
    Number.isFinite(x.netIncome) ? Number(x.netIncome) : Number.NaN
  );
  const netIncomePrev = earlier4.map((x) =>
    Number.isFinite(x.netIncome) ? Number(x.netIncome) : Number.NaN
  );
  const netIncomeLatestValid = netIncomeLatest.filter(Number.isFinite) as number[];
  const netIncomePrevValid = netIncomePrev.filter(Number.isFinite) as number[];
  const netIncomeL4 = netIncomeLatestValid.length ? sum(netIncomeLatestValid) : Number.NaN;
  const netIncomePrevL4 = netIncomePrevValid.length ? sum(netIncomePrevValid) : Number.NaN;
  const netIncomeGrowth =
    Number.isFinite(netIncomeL4) &&
    Number.isFinite(netIncomePrevL4) &&
    netIncomePrevL4 > 0
      ? safeDiv(netIncomeL4, netIncomePrevL4) - 1
      : Number.NaN;
  const pe =
    Number.isFinite(f.marketCap) && Number.isFinite(netIncomeL4) && netIncomeL4 > 0
      ? safeDiv(f.marketCap, netIncomeL4)
      : Number.NaN;
  const peg =
    Number.isFinite(pe) && Number.isFinite(netIncomeGrowth) && netIncomeGrowth > 0
      ? pe / Math.max(netIncomeGrowth, 0.05)
      : Number.NaN;

  const VAL_EBITDA_LIMIT = 25;
  const VAL_FCF_LIMIT = 35;
  const VAL_PEG_LIMIT = 2;

  const evEbitdaPass = Number.isFinite(evToEbitda)
    ? evToEbitda <= VAL_EBITDA_LIMIT
    : null;
  const evFcfPass = Number.isFinite(evToFcf)
    ? evToFcf <= VAL_FCF_LIMIT
    : null;
  const pegPass = Number.isFinite(peg)
    ? peg <= VAL_PEG_LIMIT
    : null;

  const valuationChecks = [
    {
      key: "ev_ebitda",
      label: "EV/EBITDA",
      value: evToEbitda,
      limit: VAL_EBITDA_LIMIT,
      pass: evEbitdaPass,
    },
    {
      key: "ev_fcf",
      label: "EV/FCF",
      value: evToFcf,
      limit: VAL_FCF_LIMIT,
      pass: evFcfPass,
    },
    {
      key: "peg",
      label: "PEG",
      value: peg,
      limit: VAL_PEG_LIMIT,
      pass: pegPass,
      pe,
      growth: netIncomeGrowth,
    },
  ];
  const valuationAvailable = valuationChecks.filter((item) => item.pass !== null);
  const valuationAvailableCount = valuationAvailable.length;
  const valuationPassCount = valuationAvailable.filter((item) => item.pass === true).length;
  const valuationPass =
    valuationAvailableCount >= 2 ? valuationPassCount >= 2 : null;

  // --- 十條基本快篩 ---
  const rules: any = {};

  // 1 成長率（CAGR）
  const cagrSummary = hasCagrData
    ? `近四季營收約 ${fmtCurrency(revL4)}，相較前四季 ${fmtCurrency(revP4)}，年化成長 ${fmtPercent(cagr1y)}，門檻為 30%。`
    : "資料不足：近八季營收資料不完整，無法計算年化成長率。";
  rules["1_growth_cagr"] = {
    label: "1. 成長率（CAGR）",
    summary: cagrSummary,
    metrics: [
      { label: "近四季營收", value: fmtCurrency(revL4) },
      { label: "前四季營收", value: fmtCurrency(revP4) },
      { label: "CAGR", value: fmtPercent(cagr1y) },
    ],
    value: cagr1y,
    pass: hasCagrData ? cagr1y >= 0.30 : null,
    note: hasCagrData && cagr1y >= 0.5 ? "成長動能極佳（>=50%）。" : undefined,
  };

  // 2 毛利率水準與趨勢
  rules["2_gross_margin_level_trend"] = {
    label: "2. 毛利率水準與趨勢",
    summary: Number.isFinite(gmL4) && gmTrend !== null
      ? `近四季平均毛利率為 ${fmtPercent(gmL4)}，最新一季 ${fmtPercent(gmQ[0])}，趨勢${gmTrend ? "持續走升" : "未明顯走升"}；門檻要求 ≥45% 且趨勢向上。`
      : "資料不足：毛利率或營收資料不足，暫無法評估毛利趨勢。",
    metrics: [
      { label: "平均毛利率 (L4Q)", value: fmtPercent(gmL4) },
      { label: "最新一季毛利率", value: fmtPercent(gmQ[0]) },
    ],
    avg: gmL4,
    last: gmQ[0],
    trend_up: gmTrend,
    pass: Number.isFinite(gmL4) && gmTrend !== null ? (gmL4>=0.45 && gmTrend) : null
  };

  // 3 營運現金流（OCF）品質
  rules["3_ocf_quality"] = {
    label: "3. 營運現金流（OCF）品質",
    summary: hasOcfTotals && hasOcfTrend
      ? `營運現金流 TTM 約 ${fmtNumber(ocfL4)}，近兩季 ${fmtNumber(ocfN2)} 對比前兩季 ${fmtNumber(ocfP2)}，趨勢${ocfN2 > ocfP2 ? "轉強" : "偏弱"}；需 TTM 為正且呈現改善。`
      : "資料不足：近四季營運現金流資料不完整。",
    metrics: [
      { label: "OCF TTM", value: fmtNumber(ocfL4) },
      { label: "近兩季 OCF", value: fmtNumber(ocfN2) },
      { label: "前兩季 OCF", value: fmtNumber(ocfP2) },
    ],
    ocf_ttm: ocfL4,
    trend_up: Number.isFinite(ocfN2) && Number.isFinite(ocfP2) ? ocfN2 > ocfP2 : null,
    pass: hasOcfTotals && hasOcfTrend ? (ocfL4>0 && ocfN2>ocfP2) : null
  };

  // 4 費用率（營運槓桿）
  rules["4_opex_rate"] = {
    label: "4. 費用率（營運槓桿）",
    summary: hasOpexData
      ? `近兩季營運費用率為 ${fmtPercent(opexN2)}，早前兩季為 ${fmtPercent(opexP2)}；費用率需有下降。`
      : "資料不足：費用率所需的營收或費用數據不足。",
    metrics: [
      { label: "近兩季費用率", value: fmtPercent(opexN2) },
      { label: "前兩季費用率", value: fmtPercent(opexP2) },
    ],
    near2q: opexN2,
    prev2q: opexP2,
    pass: hasOpexData ? (opexN2 < opexP2) : null
  };

  // 5 增速加速（拐點）
  rules["5_yoy_acceleration"] = {
    label: "5. 營收增速是否加速",
    summary: hasYoyData
      ? `近兩季平均年成長 ${fmtPercent(yoyN2)}，先前兩季為 ${fmtPercent(yoyP2)}，差值 ${fmtPercent(yoyDelta)}；需加速至少 5 個百分點。`
      : "資料不足：年增率計算需要至少八季營收紀錄。",
    metrics: [
      { label: "近兩季 YoY", value: fmtPercent(yoyN2) },
      { label: "前兩季 YoY", value: fmtPercent(yoyP2) },
      { label: "差值", value: fmtPercent(yoyDelta) },
    ],
    near2q: yoyN2,
    prev2q: yoyP2,
    delta: yoyDelta,
    pass: hasYoyData
      ? (yoyN2 > 0.5 && yoyP2 > 0.5) || (yoyN2 > yoyP2 + 0.05)
      : null
  };

  // 6 多面估值檢視
  const valuationSummary = valuationAvailableCount >= 2
    ? `三項估值指標通過 ${valuationPassCount}/${valuationAvailableCount} 項（需 ≥2）。`
    : "資料不足：至少需兩項估值指標可計算。";
  const valuationMetrics = valuationChecks.map((item) => {
    if (Number.isFinite(item.value)) {
      return {
        label: item.label,
        value: `${item.value.toFixed(2)}（門檻 ≤${item.limit}）${item.pass === true ? "｜✅" : item.pass === false ? "｜❌" : ""}`,
      };
    }
    if (item.key === "ev_fcf" && Number.isFinite(fcfL4) && fcfL4 <= 0) {
      return {
        label: item.label,
        value: `${fmtCurrency(fcfL4)}（FCF 為負）`,
      };
    }
    if (item.key === "peg") {
      if (!Number.isFinite(netIncomeL4) || netIncomeL4 <= 0) {
        return {
          label: item.label,
          value: "無法計算（淨利為負或為零）",
        };
      }
      if (!Number.isFinite(netIncomeGrowth) || netIncomeGrowth <= 0) {
        return {
          label: item.label,
          value: "無法計算（淨利成長率 ≤ 0）",
        };
      }
    }
    return {
      label: item.label,
      value: "資料不足",
    };
  });
  valuationMetrics.push(
    { label: "P/S", value: Number.isFinite(ps) ? ps.toFixed(2) : "無資料" },
    { label: "近四季淨利", value: fmtCurrency(netIncomeL4) },
    { label: "淨利年化成長", value: fmtPercent(netIncomeGrowth) },
    { label: "P/E (TTM)", value: Number.isFinite(pe) ? pe.toFixed(2) : "無資料" },
  );
  rules["6_val_vs_growth"] = {
    label: "6. 多面估值檢視",
    summary: `${valuationSummary} EV=${fmtCurrency(enterpriseValue)}；FCF=${fmtCurrency(fcfL4)}；PEG ${Number.isFinite(peg) ? peg.toFixed(2) : "資料不足"}`,
    metrics: valuationMetrics,
    checks: valuationChecks,
    ev: enterpriseValue,
    fcf_ttm: fcfL4,
    ebitda_ttm: ebitdaL4,
    peg,
    pe,
    net_income_growth: netIncomeGrowth,
    ps,
    pass: valuationPass,
  };

  // 7 供應可放大（CapEx 上升且毛利不惡化/≥45%）
  rules["7_capacity_without_gm_hit"] = {
    label: "7. 供應可放大且毛利守住",
    summary: capexTrend !== null && gmOkForCapex
      ? `最新一季資本支出約 ${fmtNumber(capexValues[0])}，相較前幾季平均 ${fmtNumber(avgValid(capexValues.slice(1,4)))} 為${capexTrend ? "上升" : "持平或下降"}；毛利率維持 ${fmtPercent(gmQ[0])} / 平均 ${fmtPercent(gmL4)}。需要 CapEx 上升且毛利率不墜且 ≥45%。`
      : "資料不足：資本支出或毛利率資料不足以評估擴產能力。",
    metrics: [
      { label: "最新一季 CapEx", value: fmtNumber(capexValues[0]) },
      { label: "前 3 季平均 CapEx", value: fmtNumber(avgValid(capexValues.slice(1,4))) },
      { label: "最新毛利率", value: fmtPercent(gmQ[0]) },
      { label: "平均毛利率", value: fmtPercent(gmL4) },
    ],
    capex_trend: capexTrend,
    gm_ok: gmOkForCapex,
    pass: capexTrend !== null && gmOkForCapex ? capexTrend : null
  };

  // 8 平台/研發投入
  rules["8_rd_ratio"] = {
    label: "8. 平台／研發投入",
    summary: Number.isFinite(rdRate)
      ? `近四季平均研發費用率為 ${fmtPercent(rdRate)}；門檻 15%。`
      : "資料不足：研發費用或營收資料不足，無法計算研發費用率。",
    metrics: [
      { label: "研發費用率 (L4Q 平均)", value: fmtPercent(rdRate) },
    ],
    value: rdRate,
    pass: Number.isFinite(rdRate) ? rdRate >= 0.15 : null
  };

  // 9 稀釋控制 + 治理（僅稀釋快篩；治理需人工/外部資料）
  const passDilution = (dilutionYoY!==null) ? (dilutionYoY < 0.10) : null;
  rules["9_dilution_governance"] = {
    label: "9. 稀釋控制／治理",
    summary: dilutionYoY===null
      ? "缺少攤薄後股本資料，暫無法評估稀釋。"
      : `近一年攤薄後股本變動約 ${fmtPercent(dilutionYoY)}；門檻為 ≤10%。`,
    metrics: [
      { label: "股本年變動", value: dilutionYoY===null ? "資料不足" : fmtPercent(dilutionYoY) },
    ],
    dilutionYoY,
    pass: passDilution,
    note: passDilution===null?"資料不足（不扣分）。": dilutionYoY!==null && dilutionYoY > 0.15 ? "稀釋壓力偏高，需留意可轉債或增資。" : undefined
  };

  // 10 自由現金流覆蓋率
  rules["10_fcf_coverage"] = {
    label: "10. 自由現金流覆蓋率",
    summary: fcfValid.length >= 2
      ? `近四季自由現金流約 ${fmtNumber(fcfL4)}，相當於營收的 ${fmtPercent(fcfCoverage)}。${revenueGrowing ? "營收仍高速成長，需確保 FCF 轉正。" : "營收成長幅度適中，可接受 FCF 為零上下。"}`
      : "資料不足：缺少營運現金流或資本支出，無法估算自由現金流。",
    metrics: [
      { label: "FCF TTM", value: fmtNumber(fcfL4) },
      { label: "FCF / 營收", value: fmtPercent(fcfCoverage) },
      { label: "營收年化成長", value: fmtPercent(cagr1y) },
    ],
    fcf_ttm: fcfL4,
    coverage: fcfCoverage,
    pass: fcfPass,
    note:
      hasFcfData && revenueGrowing && fcfPass === false
        ? "營收持續成長但自由現金流仍為負，需留意擴張現金消耗。"
        : undefined,
  };

  // 打分：#1~#10 每項過關 +1；未知（null）不加不扣
  const bonus = 0;
  const baseKeys = Object.keys(rules);
  const basePass = baseKeys.reduce((acc,k)=>{
    const v = rules[k].pass;
    return acc + (v===true ? 1 : 0);
  },0);
  const total = basePass + bonus;

  // --- 十大地雷（能算的幾項） ---
  const red_flags: string[] = [];

  // 地雷1：OCF/FCF 惡化（此處以 OCF 代理）
  if (
    Number.isFinite(ocfL4) &&
    Number.isFinite(ocfN2) &&
    Number.isFinite(ocfP2) &&
    ocfL4 < 0 &&
    ocfN2 < ocfP2
  ) {
    red_flags.push("OCF TTM 為負且持續走弱");
  }

  // 地雷2：品質差的成長（Δ(AR+INV) > ΔREV）
  const arInvLatest = latest4.map((x) =>
    Number.isFinite(x.receivables) && Number.isFinite(x.inventory)
      ? x.receivables + x.inventory
      : Number.NaN
  );
  const arInvPrev = earlier4.map((x) =>
    Number.isFinite(x.receivables) && Number.isFinite(x.inventory)
      ? x.receivables + x.inventory
      : Number.NaN
  );
  const hasArInvData =
    arInvLatest.length === 4 &&
    arInvPrev.length === 4 &&
    arInvLatest.every(Number.isFinite) &&
    arInvPrev.every(Number.isFinite) &&
    hasRevenueLatest &&
    hasRevenueEarlier;
  if (hasArInvData) {
    const arInvL4 = sum(arInvLatest);
    const arInvP4 = sum(arInvPrev);
    if (Number.isFinite(revL4) && Number.isFinite(revP4) && (arInvL4 - arInvP4) > (revL4 - revP4)) {
      red_flags.push("應收+存貨增加幅度 > 營收增幅");
    }
  }

  // 地雷3：毛利塌陷（同季年減 >=5pct）
  const gmYoYDrop =
    timelineQuarters[0] &&
    timelineQuarters[4] &&
    Number.isFinite(timelineQuarters[0].grossProfit) &&
    Number.isFinite(timelineQuarters[0].revenue) &&
    timelineQuarters[0].revenue !== 0 &&
    Number.isFinite(timelineQuarters[4].grossProfit) &&
    Number.isFinite(timelineQuarters[4].revenue) &&
    timelineQuarters[4].revenue !== 0
      ? safeDiv(timelineQuarters[0].grossProfit, timelineQuarters[0].revenue) -
        safeDiv(timelineQuarters[4].grossProfit, timelineQuarters[4].revenue)
      : Number.NaN;
  if (Number.isFinite(gmYoYDrop) && gmYoYDrop <= -0.05) {
    red_flags.push("毛利率同季年減 ≥5pct");
  }

  // 地雷5：稀釋壓力（>10%）
  if (dilutionYoY!==null && dilutionYoY > 0.10) red_flags.push("近一年股本稀釋 >10%");

  // 其它地雷（4/6/7/8/9/10）需外部/人工資料：預設不自動判定

  // 評語
  const rating = total>=9 ? "體質極佳" : total>=7 ? "良好" : total>=5 ? "普通" : "不符十倍股體質（現階段）";

  return {
    ticker: f.ticker,
    as_of: new Date().toISOString(),
    rules,
    red_flags,
    base_points: basePass,
    bonus_points: bonus,
    total_score: total,
    rating,
    ps, cagr1y,
    data_quality: {
      quarters: base.length,
      has_diluted_shares: (dilutionYoY!==null)
    },
    quarterly_revenue: revenueSeries.slice().reverse(),
    cagr_detail: {
      latest_periods: cagrLatestLabels,
      previous_periods: cagrPreviousLabels,
    },
  };
}
