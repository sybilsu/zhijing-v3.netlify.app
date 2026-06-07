const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');
const pdfParse = require('pdf-parse');

// Read keys directly from .env file — bypasses all environment injection
function readEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8')
        .split('\n').filter(l => l.includes('='))
        .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
    );
  } catch(e) { return process.env; }
}
const ENV = readEnv();

const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' });
const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_KEY);

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;

function extOf(filename) {
  return filename.split('.').pop().toLowerCase();
}

function chunkText(text, filename, startPage = 1) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let i = 0;
  let pageEstimate = startPage;
  while (i < words.length) {
    const slice = words.slice(i, i + CHUNK_SIZE).join(' ');
    chunks.push({
      content: slice,
      source_file: filename,
      page: pageEstimate,
      metadata: { word_count: slice.split(/\s+/).length }
    });
    pageEstimate += Math.floor(CHUNK_SIZE / 250);
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

async function embedChunks(chunks) {
  const texts = chunks.map(c => c.content);
  const results = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: batch });
    results.push(...res.data.map(d => d.embedding));
  }
  return results;
}

async function extractFromPdf(fileBase64) {
  const parsed = await pdfParse(Buffer.from(fileBase64, 'base64'));
  if (parsed.text && parsed.text.trim().length > 100) {
    console.log('[ingest] pdf-parse ok:', parsed.text.trim().length, 'chars');
    return { text: parsed.text, pages: parsed.numpages };
  }
  // Scanned PDF — no text layer
  throw new Error('此 PDF 為掃描版（無文字層）。請將每頁匯出為 JPG/PNG，以「圖片」格式上傳，系統將以 GPT-4o Vision 自動 OCR。');
}

function extractFromTxt(fileBase64) {
  const text = Buffer.from(fileBase64, 'base64').toString('utf-8');
  const pages = Math.max(1, Math.ceil(text.split(/\s+/).length / 300));
  return { text, pages };
}

async function extractFromImage(fileBase64, mimeType) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
        { type: 'text', text: '請以繁體中文詳細描述這張圖片，包含：植物種類、景觀設計特徵、季節特徵、顏色質感、空間層次、設計風格、可辨識的物種名稱。盡量詳細，以利後續語意檢索。' }
      ]
    }]
  });
  const text = res.choices[0].message.content;
  return { text, pages: 1 };
}

exports.handler = async (event) => {
if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { filename, sourceType = 'pdf', storagePath } = body;
    let fileBase64 = body.fileBase64 || body.pdfBase64;

    if (!filename) {
      return { statusCode: 400, body: JSON.stringify({ error: '缺少 filename' }) };
    }

    // Large file: download from Supabase Storage
    if (storagePath) {
      const { data, error } = await supabase.storage.from('rag-uploads').download(storagePath);
      if (error) throw new Error(`Storage download failed: ${error.message}`);
      const buffer = Buffer.from(await data.arrayBuffer());
      fileBase64 = buffer.toString('base64');
      // Clean up temp file
      await supabase.storage.from('rag-uploads').remove([storagePath]);
    }

    // Pre-extracted text (from client-side OCR pipeline)
    if (body.rawText) {
      const rawText = body.rawText;
      const pages = Math.max(1, Math.ceil(rawText.split(/\s+/).length / 300));
      const chunks = chunkText(rawText, filename);
      const embeddings = await embedChunks(chunks);
      const rows = chunks.map((c, i) => ({ content: c.content, embedding: embeddings[i], source_type: sourceType, source_file: c.source_file, page: c.page, metadata: { ...c.metadata, file_type: 'pdf_ocr' } }));
      const { error } = await supabase.from('rag_chunks').insert(rows);
      if (error) throw new Error(error.message);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, filename, chunks_stored: rows.length, pages_estimated: pages }) };
    }

    if (!fileBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: '缺少 fileBase64 或 storagePath' }) };
    }

    const ext = extOf(filename);
    let rawText, pages;

    if (ext === 'pdf') {
      ({ text: rawText, pages } = await extractFromPdf(fileBase64));
    } else if (ext === 'txt') {
      ({ text: rawText, pages } = extractFromTxt(fileBase64));
    } else if (['jpg', 'jpeg'].includes(ext)) {
      ({ text: rawText, pages } = await extractFromImage(fileBase64, 'image/jpeg'));
    } else if (ext === 'png') {
      ({ text: rawText, pages } = await extractFromImage(fileBase64, 'image/png'));
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: `不支援的檔案格式：${ext}` }) };
    }

    if (!rawText || rawText.trim().length < 10) {
      return { statusCode: 400, body: JSON.stringify({ error: '無法從檔案中讀取文字內容' }) };
    }

    const chunks = chunkText(rawText, filename);
    console.log(`[ingest] ${filename} (${ext}): ${chunks.length} chunks`);

    const embeddings = await embedChunks(chunks);

    const rows = chunks.map((c, i) => ({
      content: c.content,
      embedding: embeddings[i],
      source_type: sourceType,
      source_file: c.source_file,
      page: c.page,
      metadata: { ...c.metadata, file_type: ext }
    }));

    const { error } = await supabase.from('rag_chunks').insert(rows);
    if (error) throw new Error(error.message);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, filename, chunks_stored: rows.length, pages_estimated: pages })
    };
  } catch (err) {
    console.error('[ingest] error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
