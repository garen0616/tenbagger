"use client";
import { useMemo, useState } from "react";

type RuleMetric = { label: string; value: string };
type RuleResult = {
  pass: boolean | null;
  label?: string;
  summary?: string;
  note?: string;
  metrics?: RuleMetric[];
  [k: string]: any;
};

export default function Home() {
  const [ticker, setTicker] = useState("NVDA");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    []
  );

  const formatNumber = (value: unknown, digits = 2) => {
    return typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(digits)
      : "—";
  };

  const formatPercentValue = (value: unknown, digits = 1) => {
    return typeof value === "number" && Number.isFinite(value)
      ? `${(value * 100).toFixed(digits)}%`
      : "—";
  };

  const formatCurrency = (value: unknown) => {
    return typeof value === "number" && Number.isFinite(value)
      ? currencyFormatter.format(value)
      : "—";
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch(`/api/score?ticker=${encodeURIComponent(ticker)}`);
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = j?.error || `HTTP ${r.status}`;
        throw new Error(msg);
      }
      setData(j);
    } catch (e: any) {
      setError(e.message || "發生錯誤");
    } finally {
      setLoading(false);
    }
  };

  const badge = (rating:string) => {
    const map:any = {
      "體質極佳":"bg-green-600",
      "良好":"bg-emerald-500",
      "普通":"bg-amber-500",
      "不符十倍股體質（現階段）":"bg-rose-600"
    };
    return map[rating] || "bg-slate-600";
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 sticky top-0 z-10 bg-slate-950/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold tracking-wide">
            十倍股快篩（10 條）＋ 十大地雷
          </h1>
          {data && (
            <div className="flex items-center gap-3">
              <div className="text-right text-sm hidden md:block">
                <div className="opacity-70">總評分</div>
                <div className="text-lg font-bold">{data.total_score} 分</div>
              </div>
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${badge(data.rating)}`}>
                {data.rating}
              </span>
            </div>
          )}
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 py-6">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 md:p-6">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm opacity-80 mb-1">輸入美股代號</label>
              <input
                value={ticker}
                onChange={(e)=>setTicker(e.target.value.toUpperCase())}
                placeholder="例如：NVDA"
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs opacity-60 mt-1">支援 SEC/Finnhub/FMP 實際財報；若資料不足會顯示錯誤提示。</p>
            </div>
            <button
              onClick={run}
              disabled={loading}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2 font-semibold"
            >
              {loading ? "分析中…" : "開始測試"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 text-rose-400">錯誤：{error}</div>
        )}

        {loading && (
      <div className="mt-6 text-sm opacity-80">
        ⏳ 正在取得財報與計算各項指標（CAGR／毛利率／OCF 品質／費用率／增速拐點／估值多面檢視（EV/EBITDA／EV/FCF／PEG）／CapEx 與毛利／R&D 比率／稀釋／FCF 覆蓋率）…
          </div>
        )}

        {data && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-4">
              {Array.isArray(data.warnings) && data.warnings.length > 0 && (
                <Card>
                  <h3 className="font-semibold mb-2 text-amber-400">資料警示</h3>
                  <ul className="list-disc pl-5 space-y-1 text-xs md:text-sm text-amber-300">
                    {data.warnings.map((w: string, idx: number) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </Card>
              )}
              <Card>
                <h3 className="font-semibold mb-3">基本快篩（逐條）</h3>
                <div className="space-y-2">
                  {Object.entries(data.rules).map(([k,v]:[string,RuleResult])=>(
                    <Row key={k} name={k} value={v}/>
                  ))}
                </div>
              </Card>

              <Card>
                <h3 className="font-semibold mb-3">十大地雷</h3>
                {data.red_flags.length===0 ? (
                  <div className="text-emerald-400">未觸發可自動判定之地雷項（其餘需人工或外部資料）。</div>
                ) : (
                  <ul className="list-disc pl-5 space-y-1">
                    {data.red_flags.map((x:string,i:number)=>(<li key={i} className="text-rose-400">{x}</li>))}
                  </ul>
                )}
              </Card>
              {Array.isArray(data.quarterly_revenue) && data.quarterly_revenue.length > 0 && (
                <Card>
                  <h3 className="font-semibold mb-2">季度營收趨勢 &nbsp;|&nbsp; CAGR：{formatPercentValue(data.cagr1y)}</h3>
                  {data.cagr_detail && (
                    <div className="text-xs text-slate-400 space-y-1 mb-3">
                      <div>近四季：{Array.isArray(data.cagr_detail.latest_periods) ? data.cagr_detail.latest_periods.join("、") : "—"}</div>
                      <div>前四季：{Array.isArray(data.cagr_detail.previous_periods) && data.cagr_detail.previous_periods.length > 0 ? data.cagr_detail.previous_periods.join("、") : "—"}</div>
                    </div>
                  )}
                  <RevenueChart series={data.quarterly_revenue} formatCurrency={formatCurrency} />
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <Card>
                <h3 className="font-semibold mb-2">總覽</h3>
                <div className="text-sm space-y-1">
                  <div>代號：<span className="font-mono">{data.ticker}</span></div>
                  <div>評分：<span className="font-semibold">{data.total_score}</span></div>
                  <div>評價：<span className="font-semibold">{data.rating}</span></div>
                  <div>PS：{formatNumber(data.ps)}，CAGR：{formatPercentValue(data.cagr1y)}</div>
                  <div className="opacity-60">資料品質：{data.data_quality.quarters} 季、稀釋可判定：{String(data.data_quality.has_diluted_shares)}</div>
                </div>
              </Card>

              <Card>
                <h3 className="font-semibold mb-2">給 n8n 用</h3>
                <div className="text-xs opacity-80 space-y-2">
                  <div>HTTP Request 節點：</div>
                  <code className="block bg-slate-800 p-2 rounded overflow-x-auto">GET /api/score?ticker=NVDA</code>
                  <div>回傳 JSON 包含：<code>total_score, rating, rules, red_flags</code> 等欄位。</div>
                </div>
              </Card>
            </div>
          </div>
        )}
      </section>

      <footer className="max-w-6xl mx-auto px-4 py-10 text-xs opacity-60">
        © 十倍股快篩 • 僅供研究參考，非投資建議
      </footer>
    </main>
  );
}

function Card({children}:{children:React.ReactNode}) {
  return <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">{children}</div>;
}

function Row({name, value}:{name:string; value:RuleResult}) {
  const pass = value?.pass;
  const icon = pass===true ? "✅" : pass===false ? "❌" : "➖";
  const passText = pass===true ? "通過" : pass===false ? "未過" : "資料不足";
  const title = value?.label ?? name;
  const summary = value?.summary;
  const note = value?.note;
  const metrics = Array.isArray(value?.metrics) ? value.metrics as RuleMetric[] : [];
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800/60 py-2">
      <div className="min-w-0 space-y-2">
        <div className="font-medium">{title}</div>
        {summary && (
          <p className="text-xs md:text-sm opacity-80 leading-relaxed whitespace-pre-wrap">
            {summary}
          </p>
        )}
        {metrics.length>0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-emerald-200/80">
            {metrics.map((m, idx)=>(
              <div key={idx} className="flex items-center gap-2">
                <span className="opacity-60">{m.label}</span>
                <span className="font-mono text-emerald-100">{m.value}</span>
              </div>
            ))}
          </div>
        )}
        {note && (
          <p className="text-xs text-amber-300">📌 {note}</p>
        )}
      </div>
      <div className="shrink-0 text-sm">
        <span className={`px-2 py-1 rounded ${pass===true?"bg-emerald-700":pass===false?"bg-rose-700":"bg-slate-700"}`}>{icon} {passText}</span>
      </div>
    </div>
  );
}

function RevenueChart({
  series,
  formatCurrency,
}: {
  series: Array<{ label: string; revenue: number | null }>;
  formatCurrency: (value: unknown) => string;
}) {
  const maxValue = Math.max(...series.map((item) => (item.revenue && item.revenue > 0 ? item.revenue : 0)));

  return (
    <div className="space-y-3">
      {series.slice().reverse().map((item) => {
        const value = item.revenue;
        const width =
          maxValue > 0 && value !== null && value > 0
            ? Math.max((value / maxValue) * 100, 6)
            : 0;
        return (
          <div key={item.label} className="flex items-center gap-3">
            <span className="text-xs font-mono w-14">{item.label}</span>
            <div className="flex-1 h-2 bg-slate-800 rounded overflow-hidden">
              {width > 0 ? (
                <div
                  className="h-full bg-emerald-500 rounded"
                  style={{ width: `${Math.min(width, 100)}%` }}
                />
              ) : (
                <div className="h-full bg-slate-700 rounded" style={{ width: "6%" }} />
              )}
            </div>
            <span className="text-xs text-emerald-200 min-w-[72px] text-right">
              {value !== null ? formatCurrency(value) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
