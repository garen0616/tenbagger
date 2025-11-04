import { NextRequest } from "next/server";
import { fetchFundamentals } from "@/lib/fetchers";
import { scoreCompany } from "@/lib/scoring";
import { Fundamentals } from "@/lib/types";

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
    const providerErr = err as { reason?: string; errors?: string[] };
    const extraErrors = Array.isArray(providerErr?.errors) && providerErr?.errors.length
      ? providerErr.errors
      : [message];
    warnings.push(...extraErrors);

    if (providerErr?.reason === "exhausted") {
      const degradedFundamentals: Fundamentals = {
        ticker,
        marketCap: Number.NaN,
        quarters: [],
      };
      const degradedResult = scoreCompany(degradedFundamentals);
      return new Response(
        JSON.stringify({
          ...degradedResult,
          data_source: "degraded",
          confidence: "low",
          warnings,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ ticker, error: "資料抓取失敗", warnings }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
