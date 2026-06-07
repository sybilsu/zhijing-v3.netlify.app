// analyze-image.js — GPT-4o Vision 辨識景觀照片中的「灌木/草本/地被」植物 + 風格摘要
// 輸出 { analysis: { summary, season_estimate, texture_tags, dominant_colors, identified:[...] } }
// identified 每株含 category/foliage/height_estimate_m/spread_estimate_m/ornament → 供前端比照 Ta_4 標準評分
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
function readEnv() {
  try {
    return Object.fromEntries(fs.readFileSync(path.join(__dirname,'../../.env'),'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
  } catch(e){return process.env;}
}
const ENV = readEnv();

const VISION_PROMPT = `你是具備景觀設計與生態學知識的視覺分析師。分析這張植物景觀照片。

先用一句繁體中文描述整體種植風格與氛圍（summary）。
再辨識其中可見的「灌木」、「草本」、「地被」三類植物（排除：喬木、大樹、草坪草、苔蘚、無植物物件）。

以純 JSON 回傳（不含 markdown 標記），結構：
{
  "summary": "<一句風格摘要，繁體中文>",
  "season_estimate": "<春|夏|秋|冬>",
  "texture_tags": ["<質感語彙，最多4個>"],
  "dominant_colors": ["<hex色票，最多4個>"],
  "identified": [
    {
      "id": "P1",
      "common_name": "<台灣慣用中文名；不確定填 未明_簡短形態描述>",
      "category": "灌木" | "草本" | "地被",
      "form": "<整體型態>",
      "foliage": "<葉形，標準植物學詞彙，例：革質橢圓披針形>",
      "height_estimate_m": [<min>, <max>],
      "spread_estimate_m": [<min>, <max>],
      "ornament": "<花/果觀賞性，只描述形態與季節，不要顏色；無花果寫 觀葉>",
      "confidence": <0~1 小數>
    }
  ]
}`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const { imageBase64, mimeType = 'image/jpeg', siteConditions } = JSON.parse(event.body);
    if (!imageBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: '缺少圖片資料' }) };
    }
    const apiKey = ENV.OPENAI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY not configured' }) };

    const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1' });
    const userText = siteConditions
      ? `基地條件：日照=${siteConditions.light}，水分=${siteConditions.moisture}，海拔=${siteConditions.altitude}m，面積=${siteConditions.area}㎡。請辨識植物並輸出純 JSON。`
      : '請辨識植物並輸出純 JSON。';

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1500,
      messages: [
        { role: 'system', content: VISION_PROMPT },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: 'text', text: userText }
        ]}
      ]
    });

    let raw = response.choices[0].message.content;
    raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const analysis = JSON.parse(raw);

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysis }) };
  } catch (err) {
    console.error('analyze-image error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || '圖片分析失敗' }) };
  }
};
