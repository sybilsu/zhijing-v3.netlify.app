const MONTH_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

const SEASON_BG = {
  spring: 'rgba(125, 184, 125, 0.15)',
  summer: 'rgba(232, 200, 32, 0.15)',
  autumn: 'rgba(212, 168, 75, 0.2)',
  winter: 'rgba(181, 146, 110, 0.2)'
};

const SEASON_RANGES = [
  { name: '春', months: [3, 4, 5], color: '#7db87d', key: 'spring' },
  { name: '夏', months: [6, 7, 8], color: '#d4a84b', key: 'summer' },
  { name: '秋', months: [9, 10, 11], color: '#c87830', key: 'autumn' },
  { name: '冬', months: [12, 1, 2], color: '#b5926e', key: 'winter' }
];

export function renderSeasonalTimeline(plants) {
  const container = document.getElementById('seasonal-svg-container');
  if (!container || !plants || !plants.length) return;

  const rowH = 48;
  const headerH = 60;
  const leftW = 160;
  const colW = 50;
  const totalW = leftW + colW * 12 + 40;
  const totalH = headerH + rowH * plants.length + 20;

  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" style="font-family:'Noto Serif TC',serif;overflow:visible">`;

  // Season background bands
  SEASON_RANGES.forEach(season => {
    season.months.forEach(m => {
      const x = leftW + (m - 1) * colW;
      svgContent += `<rect x="${x}" y="${headerH}" width="${colW}" height="${rowH * plants.length}" fill="${SEASON_BG[season.key]}" />`;
    });
  });

  // Month header
  MONTH_LABELS.forEach((label, i) => {
    const x = leftW + i * colW + colW / 2;
    svgContent += `<text x="${x}" y="20" text-anchor="middle" font-size="11" fill="#7a7a70">${label}月</text>`;
  });

  // Season labels
  SEASON_RANGES.forEach(season => {
    const startM = season.months[0];
    const x = leftW + (startM - 1) * colW + (colW * 3) / 2;
    svgContent += `<text x="${x}" y="42" text-anchor="middle" font-size="13" font-weight="500" fill="${season.color}">${season.name}</text>`;
  });

  // Grid lines
  for (let i = 0; i <= 12; i++) {
    const x = leftW + i * colW;
    svgContent += `<line x1="${x}" y1="${headerH}" x2="${x}" y2="${totalH - 20}" stroke="rgba(180,180,170,0.3)" stroke-width="1"/>`;
  }

  // Plant rows
  plants.forEach((plant, idx) => {
    const y = headerH + idx * rowH;
    const midY = y + rowH / 2;

    // Row background (alternating)
    if (idx % 2 === 0) {
      svgContent += `<rect x="0" y="${y}" width="${totalW}" height="${rowH}" fill="rgba(255,255,255,0.03)"/>`;
    }

    // Plant name
    svgContent += `<text x="10" y="${midY - 5}" font-size="12" fill="#2a2a24" dominant-baseline="middle">${plant.name_zh}</text>`;
    svgContent += `<text x="10" y="${midY + 10}" font-size="9" fill="#7a7a70" font-style="italic">${(plant.name_latin || '').substring(0, 22)}</text>`;

    // Bloom bar — dashed border with real flower color
    const bloomMonths = plant.bloom_months || [];
    if (bloomMonths.length > 0) {
      const flowerFill = plant.flower_color || '#e8c820';
      bloomMonths.forEach(m => {
        const mIdx = ((m - 1) % 12);
        const bx = leftW + mIdx * colW + 2;
        const bh = rowH * 0.32;
        const by = y + rowH * 0.18;
        svgContent += `<rect x="${bx}" y="${by}" width="${colW - 4}" height="${bh}" rx="3" fill="${flowerFill}" fill-opacity="0.55" stroke="#555" stroke-width="1.2" stroke-dasharray="4,2.5" />`;
      });
      // Bloom label on first month
      const firstM = ((bloomMonths[0] - 1) % 12);
      svgContent += `<text x="${leftW + firstM * colW + colW / 2}" y="${y + rowH * 0.58}" text-anchor="middle" font-size="8" fill="#444">花</text>`;
    }

    // Structure bar
    const structMonths = plant.structural_months || [];
    if (structMonths.length > 0) {
      structMonths.forEach(m => {
        const mIdx = ((m - 1) % 12);
        const bx = leftW + mIdx * colW + 2;
        svgContent += `<rect x="${bx}" y="${y + rowH * 0.55}" width="${colW - 4}" height="${rowH * 0.25}" rx="2" fill="#9a9a92" opacity="0.6" />`;
      });
    }

    // Winter structure indicator
    if (plant.winter_structure) {
      svgContent += `<circle cx="${totalW - 22}" cy="${midY}" r="5" fill="#9a9a92" opacity="0.8" />`;
    }

    // Divider
    svgContent += `<line x1="0" y1="${y + rowH}" x2="${totalW}" y2="${y + rowH}" stroke="rgba(180,180,170,0.2)" stroke-width="0.5"/>`;
  });

  // Legend
  const legendY = totalH - 16;
  svgContent += `<rect x="${leftW}" y="${legendY - 8}" width="14" height="8" rx="2" fill="#e8c820" fill-opacity="0.55" stroke="#555" stroke-width="1.2" stroke-dasharray="4,2.5"/>`;
  svgContent += `<text x="${leftW + 18}" y="${legendY}" font-size="10" fill="#7a7a70">花期（實際花色）</text>`;
  svgContent += `<rect x="${leftW + 120}" y="${legendY - 8}" width="14" height="8" rx="2" fill="#9a9a92" opacity="0.6"/>`;
  svgContent += `<text x="${leftW + 138}" y="${legendY}" font-size="10" fill="#7a7a70">結構期</text>`;
  svgContent += `<circle cx="${leftW + 200}" cy="${legendY - 3}" r="5" fill="#9a9a92" opacity="0.8"/>`;
  svgContent += `<text x="${leftW + 210}" y="${legendY}" font-size="10" fill="#7a7a70">冬季骨幹</text>`;

  svgContent += '</svg>';
  container.innerHTML = svgContent;
}

export function calculateWinterStructureScore(plants) {
  if (!plants || !plants.length) return 0;
  const withStructure = plants.filter(p => p.winter_structure).length;
  return Math.round((withStructure / plants.length) * 100);
}
