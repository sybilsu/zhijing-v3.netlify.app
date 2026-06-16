# 植徑 v.3 — 前後端架構說明

**更新日期**：2026-06-17

---

## 系統概覽

```
使用者瀏覽器
    │
    ├─ 靜態前端（HTML / CSS / 原生 JS）
    │      index.html + style.css
    │      src/app.js          ← 主流程協調
    │      src/upload.js       ← 圖片處理
    │      src/matching.js     ← 前端植物評分引擎
    │      src/matrix.js       ← BOQ 計算
    │      src/seasonal.js     ← 四季時間軸
    │      src/export.js       ← Excel 匯出（SheetJS）
    │
    └─ Netlify Functions（Serverless 後端）
           /api/analyze-image  ← GPT-4o Vision 影像辨識
           /api/match-plants   ← AI 植物配對（目前保留，前端已可純程式碼比對）
           /api/query-rag      ← RAG 語意檢索
           /api/ingest-pdf     ← PDF 知識庫上傳
           /api/list-rag       ← 列出 RAG 文件
           /api/generate-rag   ← RAG chunk 生成
           /api/get-upload-url ← S3/Storage 預簽 URL
           /api/ocr-page       ← PDF 頁面 OCR
```

---

## 前端架構

### 資料來源

| 資料 | 檔案 | 種類數 | 說明 |
|---|---|---|---|
| 台灣原生植物庫 | `data/plants_enriched.json` | **500 種** | 比對評分主資料庫；來源 `taiwan native/2026_植物屬性表_500種.xlsx` |
| Piet 原則 RAG | `data/piet-principles.json` | — | 設計原則知識庫（JSON chunks） |
| Piet 物種資料 | `data/piet-species.json` | 15 種 | Piet 慣用植物參照 |
| Demo 備援資料 | `data/demo-fallback.json` | — | AI 逾時時的示範輸出 |

### 評分引擎（`src/matching.js`）

純前端、零 API、確定性評分：

```
GPT-4o 辨識結果（identified[]）
    │
    └─ 同類別篩選（灌木 / 草本 / 地被）
           │
           └─ 四維評分
                  葉形 Jaccard × 30
                  高度重疊   × 10
                  展幅重疊   × 5
                  觀賞期     × 5
                  基底分      50
                  ──────────────
                  總分 → 星等（≥90=5★, ≥75=4★, ≥60=3★）
```

強配（≥4★）預設納入方案；弱配（3★）可手動展開後逐株納入。

### 植物圖像

- 路徑：`/public/photos/<植物中文名>_<slot>.jpg`
- 三個 slot：`_leaf`（葉）、`_close`（近景，主圖備援）、`_habit`（全株）
- 圖像現況：部分齊備（Demo 可用）；缺圖自動 hide，不影響流程

---

## 後端架構（Netlify Functions）

### `analyze-image.js`（核心）

```
POST /api/analyze-image
  input : { base64, mimeType, siteConditions }
  output: { analysis: { identified[], summary, texture_tags,
                         dominant_colors, season_estimate } }
  model : GPT-4o Vision
```

辨識類別：灌木 / 草本 / 地被，每株含 `confidence`、`foliage`、高度/展幅估算。

### `match-plants.js`（輔助，目前前端可獨立完成）

```
POST /api/match-plants
  input : { designDNA, siteConditions, ragChunks }
  reads : data/plants-mock.json（舊 20 種；待升級為 plants_enriched.json）
  output: { palettes[2-3] }
  model : GPT-4o-mini
```

> **注意**：前端 `matching.js` 已可對 500 種資料庫做純程式碼評分，`match-plants.js` 已非必要路徑，保留供 AI 語意配對場景使用。

### RAG 相關函數

| 函數 | 功能 |
|---|---|
| `ingest-pdf.js` | 上傳 PDF → 分頁 OCR → 存入 RAG store |
| `ocr-page.js` | 單頁圖像 OCR（GPT-4o） |
| `generate-rag.js` | 生成 RAG chunk 嵌入 |
| `query-rag.js` | 語意檢索（向量 / 關鍵字） |
| `list-rag.js` | 列出現有 RAG 文件 |

---

## 資料流（完整）

```
① 使用者上傳圖片 + 基地條件
        ↓
② analyze-image（GPT-4o Vision）
   → identified[]（灌木/草本/地被，含葉形/高度/展幅/信心度）
        ↓
③ 前端 scoreSubstitutes()（matching.js）
   → 讀 plants_enriched.json（500 種）
   → 同類別評分 → pool（≥4★）+ weak_pool（3★）
        ↓
④ renderPools()：顯示植物卡，使用者點「納入方案」
        ↓
⑤ 動態矩陣計算（matrix.js）
   → 依 getSelectedList() 計算 BOQ（數量 / 盆型 / 間距）
        ↓
⑥ 四季時間軸（seasonal.js）
   → 依花期/結構期欄位生成春夏秋冬時間軸
        ↓
⑦ Excel 匯出（export.js + SheetJS）
   → 輸出植栽表（BOQ + 季相 + 評分細項）
```

---

## 部署

| 項目 | 設定 |
|---|---|
| 平台 | Netlify（GitHub main → 自動發布） |
| Functions runtime | Node.js 20 |
| 靜態根 | `/`（index.html） |
| API prefix | `/api/*` → `/.netlify/functions/:splat` |
| 環境變數 | `OPENAI_API_KEY`（Netlify 後台設定） |

---

## 資料庫演進路線

| 階段 | 種類數 | 資料格式 | 圖像 |
|---|---|---|---|
| 初版（v.3.0） | 20 種 | `plants-mock.json` | 無 |
| 現況（v.3.1） | **500 種** | `plants_enriched.json` | 部分（Demo 可用） |
| 目標（v.4） | 1000 種 | JSON / Supabase pgvector | 全庫三角度 |
