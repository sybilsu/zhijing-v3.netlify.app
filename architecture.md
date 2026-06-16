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

---

## 驗證層（Validation Layer）

### S_attr 視覺相似度評分架構

核心邏輯位於 `src/matching.js` 的 `scorePair()` 函式，**總分 100**：

| 分項 | 權重 | 計算方式 | 文獻依據 |
|---|---|---|---|
| 類別 (category) | **50**（硬性 gate） | 灌木 / 草本 / 地被須完全相同，否則排除（回傳 null） | — |
| 葉形 (foliage) | **30**（最高軟性權重） | 27 項葉形關鍵字詞庫 → Jaccard 相似度 | EP433 [1]、PLOS ONE [5] |
| 高度 (height) | **10** | 估計高度區間 vs 資料庫 HEIGHT 欄位數值重疊比例 | EP416 [2]、眼動追蹤 [11] |
| 展幅 (spread) | **5** | 估計展幅區間 vs 資料庫 SPREAD 欄位數值重疊比例 | 同上 |
| 觀賞 (ornament) | **5** | 26 項觀賞特徵關鍵字（FLW SEASON + STRUCT INT）→ Jaccard | Oudolf [4] |

**設計決策**：色彩（短暫特性）刻意排除於 S_attr，由 Step 02 色彩篩選器獨立處理，避免干擾形態相似度這一核心判準。[EP433, ScienceDirect 12/13/14]

**Role（角色）**：目前不計入 S_attr；以結構相容性標籤呈現。待 Phase 5 A/B 測試後決定是否納入。

### S_llm 效標（VLM-as-Judge）

以 **Claude Haiku 4.5 Vision** 作為外部視覺相似度評審，對每組「參考圖裁切 × 候選植物照片」給出 0–100 分，作為 S_attr 排名的效標。

| 驗證指標 | 說明 | 通過門檻 |
|---|---|---|
| Spearman ρ(S_attr, S_llm) | S_attr 排名 vs S_llm 排名的等級相關係數 | ρ ≥ 0.6（最低可接受）；**ρ ≥ 0.7（目標值）** |
| Overlap@5 | S_attr 前 5 vs S_llm 前 5 的重疊筆數 | 參考指標（非通過 / 失敗門檻） |
| S_llm 一致性 SD | 同配對重複評分 3 次的標準差 | **SD ≤ 15**（0–100 分尺度） |

> 文獻基準：VLM-as-Judge 研究（arXiv 2504.00938、Prometheus-Vision）回報 Spearman ρ 落在 **0.73–0.84** 之間，本驗證以此對齊目標值。

---

## 驗證實驗設計（Phase 1–6）

### Phase 概覽

| 階段 | 目的 | 預估成本 | 預估時間 |
|---|---|---|---|
| **Phase 1** | 修正 `scripts/validate-similarity.mjs` 語法錯誤；建立 S_attr-only 基準（15 組輸入植株完整排名） | $0 | 10–20 分鐘 |
| **Phase 2** | 全量 S_attr vs S_llm 相關性驗證（≈100–110 組配對，--max-calls 120），計算 Spearman ρ 與 Overlap@5 | $0.20–0.33 | 30–60 分鐘 |
| **Phase 3** | S_llm 一致性檢驗：Phase 2 中 ρ 較低的 5 組，各取前 3 名候選，--repeat 3 重複評分，計算 SD | $0.11 | 10–20 分鐘 |
| **Phase 4** | 權重校準（NNLS 投影梯度下降）+ held-out 保留樣本驗證（校準集 10 組 / 測試集 5 組），防止過適 | $0（重用 Phase 2 數據） | 20–30 分鐘 |
| **Phase 5** | Role 維度探索性 A/B 測試：`scorePairWithRole()` vs 原 `scorePair()`，比較 ρ 是否提升 ≥ 0.05 | $0（重用 Phase 2 數據） | 30–45 分鐘 |
| **Phase 6**（選配） | S_llm vs 人類專家小樣本比對（12–15 組，2–3 位景觀設計師），驗證 S_llm 效標可信度 | $0 API + 人力 | 視配合度 |
| **合計（Phase 1–5）** | — | **≈ $0.31–0.44** | **≈ 1.5–2.5 小時** |

### Phase 4 決策規則

```
校準集（run_01–04，10 組）
        ↓
  calibrateWeights() [foliage, height, spread, ornament]
        ↓
候選權重 → 重計保留測試集（run_05，5 組）S_attr 排名
        ↓
  ρ(候選) > ρ(原始) 且 foliage 未被大幅調降？
        ├─ 是 → 寫入 validation/similarity-weights.calibrated.json
        │        → 人工審核後更新 src/matching.js WEIGHTS
        └─ 否 → 維持現行權重，記錄供未來資料量擴增後參考
```

### Phase 5 決策規則

```
scorePairWithRole() 對 15 組輸入植株重新評分
        ↓
ρ(S_attr_v2, S_llm) vs ρ(S_attr, S_llm)
        ├─ ρ 提升 ≥ 0.05 且方向一致
        │        → 正式將 roleMatch() 併入 scorePair()
        │        → 雷達圖由五軸擴為六軸（新增「角色」軸）
        └─ 提升不明顯或下降
                 → 不計分，改以「結構角色」徽章（badge）呈現於 UI
                 → 呼應 Step 05 七三法則（70/30 結構保留率）
```

### 驗證完成後調整情境

| 情境 | 條件 | 主要程式碼異動 |
|---|---|---|
| A | Phase 2 ρ ≥ 0.7，Phase 4 無顯著提升 | 僅更新 `validation-report.md`，WEIGHTS 不動 |
| B | Phase 4 校準在保留樣本有提升 | 更新 `src/matching.js` WEIGHTS；同步 `validation/similarity-weights.calibrated.json` |
| C1 | Phase 5 Role A/B 提升 ≥ 0.05 | `scorePair()` 新增 role 軸；`SimilarityRadar` 五邊形 → 六邊形 |
| C2 | Phase 5 Role 無提升 | 前端新增結構角色 badge，評分邏輯不動 |

### 中長期驗證路線

| 方向 | 觸發條件 | 說明 |
|---|---|---|
| S_cnn（CLIP 影像嵌入） | 資料庫擴至 ≥ 200 種 | 與 S_llm 共構三方驗證（S_attr / S_cnn / S_llm） |
| 長期視覺穩定性指標 | 種植 1–3 年後回訪 | LONGEVITY / SPREADING / PERSIST / SELF-SOW 等屬性納入延伸驗證 |
| Phase 6 人類專家比對 | 本期資源不足未執行時 | 下一輪優先補充，強化 S_llm 效標可信度論證 |
