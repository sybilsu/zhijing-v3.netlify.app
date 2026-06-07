const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
function readEnv() {
  try { return Object.fromEntries(fs.readFileSync(path.join(__dirname,'../../.env'),'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];})); } catch(e){return process.env;}
}
const ENV = readEnv();
const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { filename } = JSON.parse(event.body);
    if (!filename) return { statusCode: 400, body: JSON.stringify({ error: '缺少 filename' }) };

    const storagePath = `uploads/${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const { data, error } = await supabase.storage
      .from('rag-uploads')
      .createSignedUploadUrl(storagePath);

    if (error) throw new Error(error.message);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedUrl: data.signedUrl, token: data.token, storagePath })
    };
  } catch (err) {
    console.error('[get-upload-url] error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
