# CLAUDE.md — Native Planting AI Designer

## Project Overview

AI-assisted naturalistic planting design tool based on Piet Oudolf's principles, matching Taiwan's central native plants as alternatives. Targets landscape designers.

**Live deploy**: Netlify auto-deploy from GitHub main branch.
**Style reference**: https://caojing-native-plant.netlify.app/ — Liquid Glass aesthetic, Apple WWDC 2025 UI language.

---

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (no build step for MVP) or React (if complexity grows)
- **Backend**: Netlify Functions (serverless, `/netlify/functions/`)
- **AI**: OpenAI GPT-4o (vision) + Qwen2.5-VL API (Chinese semantic matching)
- **RAG**: Pre-embedded Piet Oudolf principle docs (JSON chunks stored in `/data/rag/`)
- **Export**: SheetJS (xlsx) for Excel export
- **Deploy**: GitHub → Netlify CI/CD

---

## Repository Structure

```
/
├── index.html                  # Single-page app entry
├── style.css                   # Liquid glass design system
├── src/
│   ├── app.js                  # Main app logic
│   ├── upload.js               # Image upload + GPT-4o call
│   ├── matching.js             # Plant matching logic
│   ├── matrix.js               # Dynamic matrix calculator
│   ├── seasonal.js             # Seasonal timeline generator
│   └── export.js               # Excel/PDF export
├── netlify/
│   └── functions/
│       ├── analyze-image.js    # GPT-4o vision API call
│       ├── match-plants.js     # Qwen2.5-VL + RAG matching
│       └── generate-rag.js     # RAG query handler
├── data/
│   ├── plants-mock.json        # MVP: 20 mock plant entries
│   ├── plants-full.json        # Full: 1000 Taiwan central natives
│   ├── piet-principles.json    # RAG chunks from "Planting" book
│   └── piet-species.json       # Piet's commonly used plant database
├── public/
│   └── assets/                 # Images, icons
├── netlify.toml                # Netlify config
└── .env.example                # OPENAI_API_KEY, QWEN_API_KEY
```

---

## Design System — Liquid Glass

```css
/* Core tokens */
--glass-bg: rgba(255, 255, 255, 0.12);
--glass-border: rgba(255, 255, 255, 0.25);
--glass-blur: blur(24px);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
--color-mist: #f5f4f0;
--color-sage: #8a9e82;
--color-smoke: #b8b5ae;
--color-bark: #c4a882;
--font-en: 'Inter', sans-serif;
--font-zh: 'Noto Serif TC', serif;

/* Glass card pattern */
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  box-shadow: var(--glass-shadow);
}

/* Plant recognition grey mask overlay */
.plant-mask {
  position: absolute;
  background: rgba(180, 180, 180, 0.18);
  backdrop-filter: blur(1px);
  border-radius: 4px;
  pointer-events: none;
}
```

**Layout**: Full-bleed background photo (low saturation plant photography) → glass panel overlay. Slow fade-in animations (400ms ease-out).

---

## AI Flow Implementation

### Step 1 — GPT-4o Style Extraction
**Netlify Function**: `analyze-image.js`

```js
// Input: base64 image + site conditions
// Output: { layers, texture, colors, species_hints, foggy_score }
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{
    role: "user",
    content: [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` }},
      { type: "text", text: STYLE_EXTRACTION_PROMPT }
    ]
  }]
});
```

**STYLE_EXTRACTION_PROMPT** must ask for:
- Plant layers (tree / shrub / grass / ground)
- Texture (airy / structural / flowing / dense)
- Piet design DNA tags
- Seasonal cues visible
- Foggy/hazy quality score (0-10)

### Step 2 — RAG + Semantic Matching
**Netlify Function**: `match-plants.js`

1. Embed GPT-4o output → cosine similarity search against `piet-principles.json`
2. Pass top-3 principle chunks + visual description to Qwen2.5-VL
3. Qwen returns Taiwan native candidates with scores

**Qwen prompt pattern** (Traditional Chinese):
```
你是台灣中部原生植物專家。根據以下 Piet Oudolf 設計 DNA 與植栽原則，
從台灣中部原生植物庫中找出最適合的替代種，依符合度排序並說明理由。
設計 DNA: {gpt4o_output}
Piet 原則: {rag_chunks}
輸出格式: JSON，包含 plant_name_zh, plant_name_latin, match_score, role, reason_zh
```

### Step 3 — Dynamic Matrix Calculator
**File**: `src/matrix.js`

```js
// Ratios: matrix 50%, primary 30%, dispersal 10%, filler 10%
function calculateBOQ(areaM2, plantList) {
  const densities = { matrix: 6, primary: 3, dispersal: 1.5, filler: 8 }; // plants/m²
  const potSizes = { matrix: '5吋', primary: '5吋', dispersal: '4吋', filler: '3吋' };
  // returns { plant, quantity, pot_size, spacing_cm }
}
```

### Step 4 — Seasonal Timeline
**File**: `src/seasonal.js`

Four seasons for Taiwan's central climate:
- 春（3-5月）: 新芽萌發、嫩綠
- 夏（6-8月）: 花期高峰
- 秋（9-11月）: 穗序展開、色彩轉變
- 冬（12-2月）: 枯黃骨幹結構（Piet 核心美學）

Output: SVG or HTML timeline bar per plant showing active / dormant / flowering phases.

---

## Plant Data Schema

### `plants-mock.json` (MVP — 20 entries)
```json
{
  "id": "tw-001",
  "name_zh": "台灣野古草",
  "name_latin": "Arundinella formosana",
  "role": "matrix",
  "piet_analog": "Molinia caerulea",
  "match_tags": ["飄逸", "冬骨幹", "禾本科"],
  "seasons": { "spring": "green", "summer": "flower", "autumn": "plume", "winter": "structure" },
  "site": { "light": ["full", "partial"], "moisture": ["dry", "mesic"], "altitude_m": [0, 2000] },
  "pot_sizes": ["4吋", "5吋"],
  "image_sm": "/public/plants/tw-001-sm.jpg",
  "image_md": "/public/plants/tw-001-md.jpg",
  "image_lg": "/public/plants/tw-001-lg.jpg"
}
```

### `piet-principles.json` (RAG chunks)
```json
{
  "chunk_id": "p-001",
  "source": "Planting: A New Perspective",
  "principle": "matrix planting",
  "text_en": "The matrix plant provides the ground layer that unifies the planting...",
  "text_zh": "基質植物提供統一整體種植的地被層...",
  "tags": ["matrix", "unity", "ground layer"]
}
```

---

## Netlify Configuration

```toml
# netlify.toml
[build]
  publish = "."
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

**Environment variables** (set in Netlify dashboard):
- `OPENAI_API_KEY`
- `QWEN_API_KEY` (Alibaba Cloud DashScope)

---

## GitHub → Netlify Setup

1. Push repo to GitHub
2. Connect repo in Netlify dashboard → auto-deploy on `main` push
3. Set env vars in Netlify: Site settings → Environment variables
4. Feature branches auto-generate preview URLs

**Branch strategy**:
- `main` → production
- `dev` → staging (optional Netlify preview)
- `feature/*` → PR preview

---

## UI Sections (Single Page)

```
[Hero] — 全幅背景植物攝影 + 毛玻璃標題面板
  └─ "上傳參考圖提取設計 DNA"

[Step 1] — 圖片上傳區（drag & drop）+ 基地條件輸入
  └─ 日照 / 水分 / 海拔 / 面積

[Step 2] — 風格特徵萃取結果（glass card）
  └─ 辨識植物以極薄灰膜遮罩標示

[Step 3] — 植栽提案（2-3 組 tabs）
  └─ Full Planting Palette + 符合度 %

[Step 4] — 動態矩陣計算器
  └─ 輸入面積 → 輸出 BOQ 表格

[Step 5] — 四季時間軸
  └─ 橫軸：春夏秋冬 / 縱軸：各植物

[Export] — 下載 Excel 植栽表 / PDF 面積預估
```

---

## MVP Testing (No Full Database Required)

The app is testable with `plants-mock.json` (20 species). All AI calls are real (GPT-4o + Qwen), only the plant lookup pool is limited. Replace `plants-mock.json` with `plants-full.json` (1000 species) when database is ready — no code change needed.

To run locally:
```bash
npm install -g netlify-cli
netlify dev   # serves functions + static at localhost:8888
```

---

## Key Constraints

- Never store API keys in frontend JS — always call via Netlify Functions
- Plant images served from `/public/plants/` — no external CDN dependency for MVP
- RAG runs client-side cosine similarity for MVP (JSON lookup), upgrades to vector DB (Pinecone/Supabase pgvector) in v2
- Excel export via SheetJS — no server-side dependency
- All Chinese text in Traditional Chinese (繁體中文)
