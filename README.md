## 十倍股快篩（Next.js + Tailwind）

此專案提供一個繁體中文的 Web UI 與 `/api/score` 端點，讓使用者輸入美股代號後，即時取得「十條基本快篩 + 十大地雷」分析結果，並顯示逐項說明、警示與營收趨勢圖。頁面亦適合作為 n8n HTTP 節點的輸出。

### 主要特色
- **多層資料來源**：依序嘗試 SEC EDGAR → Financial Modeling Prep (FMP) → Alpha Vantage → Finnhub；全部失敗時會進入降規模式，仍提供摘要並標示資料不足。
- **季度資料校正**：解析最新季度起連續 8 季的實際財報，確保 CAGR、YoY 以及各項比率皆以一致的時間窗計算。
- **前端體驗**：結果以卡片與條狀圖呈現，逐條列出規則（含 EV/EBITDA、EV/FCF、PEG、自由現金流覆蓋率）說明、原始指標與通過狀態，並指出觸發的地雷項目。

## 環境設定

請先建立環境變數檔（`cp .env.example .env.local`）並填入以下資訊：

```env
FMP_API_KEY=your_fmp_api_key
FINNHUB_API_KEY=your_finnhub_api_key
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key
SEC_USER_AGENT="tenbagger-checker/0.1 (your.name@example.com)"
```

- `SEC_USER_AGENT` 必須包含可聯絡到你的 email 或網址，符合 SEC API 的使用規範。
- 若某個來源缺少授權或被限流，系統會自動切換至下一個來源並於回傳結果的 `warnings` 中說明；全部失敗時會回傳降規結果（`data_source = degraded`，可信度較低）。

## 開發流程

```bash
npm install
npm run dev
```

開啟瀏覽器造訪 [http://localhost:3000](http://localhost:3000)，即可互動測試。API 端點可直接於瀏覽器或自動化流程呼叫：`GET /api/score?ticker=AAPL`。

若要執行單元測試：

```bash
npm run test
```

## 目錄結構

- `app/`：Next.js App Router 頁面與 API route。
- `lib/`：財報抓取（`fetchers.ts`）與評分邏輯（`scoring.ts`）等核心函式。
- `tests/`：Vitest 單元測試與 fixture。
- `public/`：靜態資產。

## 注意事項

- 留意外部 API 的速率限制，尤其是 SEC EDGAR；建議實務部署時加入快取或排隊機制。
- `fetchers.ts` 內已包含簡易的單位換算與季度補值邏輯，若擴充其它指標（如 RPO、Backlog），請確保不同來源的單位一致再合併。
