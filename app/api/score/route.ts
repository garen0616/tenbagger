import { NextRequest } from "next/server";
import { fetchFundamentals } from "@/lib/fetchers";
import { scoreCompany } from "@/lib/scoring";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") || "NVDA").toUpperCase();

  console.log(`📊 開始分析 ${ticker} ...`);
  const warnings: string[] = [];

  try {
    console.log("  ↪️ 嘗試抓取財報資料...");
    const fundamentals = await fetchFundamentals(ticker);
    console.log("  ✅ 抓取成功");

    const result = scoreCompany(fundamentals as any);
    console.log("  ✅ 分析完成：", { total_score: result.total_score, rating: result.rating });

    return new Response(JSON.stringify({ ...result, data_source: "live", warnings }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.warn("  ⚠️ 抓取失敗：", message);
    warnings.push(message);

    return new Response(JSON.stringify({ ticker, error: "資料抓取失敗", warnings }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
