const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
function readEnv() {
  try { return Object.fromEntries(fs.readFileSync(path.join(__dirname,'../../.env'),'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];})); } catch(e){return process.env;}
}
const ENV = readEnv();
const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  try {
    const { imageBase64 } = JSON.parse(event.body);
    if (!imageBase64) return { statusCode: 400, body: JSON.stringify({ error: '缺少 imageBase64' }) };

    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2000,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } },
        { type: 'text', text: '請提取這頁中的所有文字，保持段落格式，只輸出原始文字，不加任何說明或標記。' }
      ]}]
    });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: res.choices[0].message.content }) };
  } catch (err) {
    console.error('[ocr-page] error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
