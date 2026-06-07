import { initUpload } from './upload.js';
import { scoreSubstitutes, getSelectedList, renderPools, renderExtractionResult } from './matching.js';
import { initMatrix, calculateBOQ } from './matrix.js';
import { renderSeasonalTimeline, calculateWinterStructureScore } from './seasonal.js';
import { exportExcel, saveProjectToStorage } from './export.js';

// App state
const state = {
  currentSection: 'hero',
  imageBase64: null,
  siteConditions: {},
  analysis: null,
  pool: null,
  weak_pool: null,
  selectedList: [],
  boqData: null
};

window.__appState = state;

// Section navigation
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  state.currentSection = id;

  // Update nav
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.section === id);
  });
}

// Skeleton loading
function showSkeleton(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="skeleton-wrap">
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
      <div class="skeleton skeleton-block"></div>
      <div class="skeleton skeleton-line"></div>
    </div>
  `;
}

function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3500);
}

// 示範資料徽章：備援啟動時於畫面上方顯示，誠實標註此為非即時 AI 結果
function setDemoBadge(on) {
  let b = document.getElementById('demo-badge');
  if (on) {
    if (!b) {
      b = document.createElement('div');
      b.id = 'demo-badge';
      b.textContent = '示範資料';
      b.style.cssText = 'position:fixed;top:62px;left:50%;transform:translateX(-50%);z-index:300;background:rgba(196,168,130,0.95);color:#fff;font-size:0.7rem;letter-spacing:0.12em;padding:4px 14px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,0.15)';
      document.body.appendChild(b);
    }
  } else if (b) {
    b.remove();
  }
}

// Initialize upload section
initUpload({
  onImageLoaded(dataUrl) {
    // Image preview ready
  },
  onAnalysisStart() {
    showSection('extraction-section');
    showSkeleton('dna-result');
    document.getElementById('color-palette').innerHTML = '';
    document.getElementById('extraction-loading').style.display = 'flex';
  },
  onAnalysisComplete(analysis, base64, siteConditions, isDemo) {
    state.analysis = analysis;
    state.imageBase64 = base64;
    state.siteConditions = siteConditions;
    window.__appState = state;
    window.__demoMode = !!isDemo;

    document.getElementById('extraction-loading').style.display = 'none';
    renderExtractionResult(analysis, base64);
    document.getElementById('match-plants-btn').disabled = false;
    setDemoBadge(isDemo);
    showToast(isDemo ? 'AI 連線忙線，已自動套用示範資料' : '植物辨識完成！', isDemo ? 'info' : 'success');
  },
  onError(msg) {
    showToast(msg, 'error');
    document.getElementById('extraction-loading').style.display = 'none';
  }
});

// Match plants button
document.getElementById('match-plants-btn')?.addEventListener('click', async () => {
  if (!state.analysis) return;

  showSection('palette-section');
  showSkeleton('palette-results');
  document.getElementById('palette-loading').style.display = 'flex';
  document.getElementById('palette-tabs').innerHTML = '';

  try {
    const { pool, weak_pool } = await scoreSubstitutes(state.analysis);
    state.pool = pool;
    state.weak_pool = weak_pool;
    window.__appState = state;

    document.getElementById('palette-loading').style.display = 'none';
    renderPools(pool, weak_pool, () => {
      // 使用者「納入/移除」植物時，即時重算 BOQ（季相下次開啟時也會反映）
      state.selectedList = getSelectedList();
      matrixController.update();
    });
    state.selectedList = getSelectedList();

    matrixController.update();
    if (window.__demoMode) setDemoBadge(true);
    const total = ['灌木', '草本', '地被'].reduce((n, c) => n + (pool[c]?.length || 0), 0);
    showToast(window.__demoMode ? `示範資料：比對出 ${total} 筆強配` : `比對完成：${total} 筆 ≥4★ 強配（已納入方案，可再加弱配）`, window.__demoMode ? 'info' : 'success');
  } catch (err) {
    showToast(err.message || '植物比對失敗', 'error');
    document.getElementById('palette-loading').style.display = 'none';
  }
});

// Matrix calculator
const matrixController = initMatrix(() => {
  return (state.selectedList && state.selectedList.length) ? { plants: state.selectedList } : null;
});

// Seasonal timeline button
document.getElementById('view-seasonal-btn')?.addEventListener('click', () => {
  const plants = state.selectedList || [];
  if (!plants.length) { showToast('尚無可用植物，請先完成分析', 'error'); return; }

  const score = calculateWinterStructureScore(plants);
  showSection('seasonal-section');
  renderSeasonalTimeline(plants);

  const scoreEl = document.getElementById('winter-score');
  if (scoreEl) {
    scoreEl.textContent = score + '%';
    scoreEl.style.color = score >= 30 ? '#8fa688' : '#c4a882';
  }
});

// Export
document.getElementById('export-excel-btn')?.addEventListener('click', () => {
  const plants = state.selectedList || [];
  if (!plants.length) { showToast('請先完成植栽提案分析', 'error'); return; }

  const area = parseFloat(document.getElementById('matrix-area')?.value || 100);
  const pot = document.getElementById('matrix-pot')?.value || '5吋';
  const boq = calculateBOQ(area, plants, pot);

  exportExcel('台灣原生替代方案', plants, boq, state.siteConditions);
  showToast('Excel 植栽清單已下載', 'success');
});

// Save project
document.getElementById('save-project-btn')?.addEventListener('click', () => {
  if (!state.analysis) { showToast('尚無可儲存的資料', 'error'); return; }
  saveProjectToStorage({
    analysis: state.analysis,
    siteConditions: state.siteConditions,
    pool: state.pool,
    selectedList: state.selectedList
  });
  showToast('專案已儲存至本地', 'success');
});

// Nav links
document.querySelectorAll('.nav-link').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const target = a.dataset.section;
    if (target === 'seasonal-section') {
      document.getElementById('view-seasonal-btn')?.click();
    } else {
      showSection(target);
    }
  });
});

// Hero CTA
document.getElementById('hero-cta')?.addEventListener('click', () => showSection('upload-section'));

// "Back to upload" button
document.getElementById('back-to-upload')?.addEventListener('click', () => showSection('upload-section'));

// "To matrix" button
document.getElementById('to-matrix-btn')?.addEventListener('click', () => {
  showSection('matrix-section');
  matrixController.update();
});

// "To seasonal" button (from matrix)
document.getElementById('matrix-to-seasonal-btn')?.addEventListener('click', () => {
  document.getElementById('view-seasonal-btn')?.click();
});

// "To export" button
document.getElementById('to-export-btn')?.addEventListener('click', () => showSection('export-section'));
