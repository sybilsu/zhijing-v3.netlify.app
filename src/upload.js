export function initUpload({ onImageLoaded, onAnalysisStart, onAnalysisComplete, onError }) {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const uploadPreview = document.getElementById('upload-preview');
  const previewImg = document.getElementById('preview-img');
  const analyzeBtn = document.getElementById('analyze-btn');
  const uploadPlaceholder = document.getElementById('upload-placeholder');

  let currentFile = null;
  let currentBase64 = null;

  // Drag & drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  analyzeBtn.addEventListener('click', () => {
    if (!currentBase64) return;
    const siteConditions = collectSiteConditions();
    startAnalysis(currentBase64, currentFile.type, siteConditions);
  });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      onError('請上傳 JPG 或 PNG 格式的圖片');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onError('圖片大小不得超過 10MB');
      return;
    }

    currentFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      // Strip data URL prefix to get pure base64
      currentBase64 = dataUrl.split(',')[1];

      previewImg.src = dataUrl;
      uploadPlaceholder.style.display = 'none';
      uploadPreview.style.display = 'block';
      analyzeBtn.disabled = false;

      onImageLoaded(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function collectSiteConditions() {
    return {
      light: document.getElementById('site-light')?.value || '全日照',
      moisture: document.getElementById('site-moisture')?.value || '中等',
      altitude: parseInt(document.getElementById('site-altitude')?.value || 200),
      area: parseFloat(document.getElementById('site-area')?.value || 100)
    };
  }

  async function startAnalysis(base64, mimeType, siteConditions) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = '分析中…';
    onAnalysisStart();

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 24000);
      try {
        const response = await fetch('/api/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mimeType, siteConditions }),
          signal: ctrl.signal
        });
        clearTimeout(timer);

        if (!response.ok) {
          let errMsg = '分析失敗';
          try {
            const err = await response.json();
            errMsg = err.error || errMsg;
          } catch (_) {}
          throw new Error(errMsg);
        }

        const { analysis } = await response.json();
        onAnalysisComplete(analysis, base64, siteConditions, false);
      } catch (apiErr) {
        clearTimeout(timer);
        // 防當機備援：AI 逾時/失敗時自動載入示範資料，讓 Demo 流程不中斷
        console.warn('[analyze-image] 失敗，改用示範備援：', apiErr.message);
        const demo = await loadDemoFallback();
        if (demo && demo.analysis) {
          onAnalysisComplete(demo.analysis, base64, siteConditions, true);
        } else {
          onError(apiErr.message || '分析失敗');
        }
      }
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = '開始分析';
    }
  }

  async function loadDemoFallback() {
    try {
      const r = await fetch('/data/demo-fallback.json');
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  }
}
