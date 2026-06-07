export function exportExcel(paletteName, plants, boqData, siteConditions) {
  if (!window.XLSX) {
    alert('匯出模組載入中，請稍後再試');
    return;
  }

  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();

  // Sheet 1: BOQ 植栽清單
  const boqRows = [
    ['植物名稱', '學名', '植栽角色', '對應Piet植物', '盆型規格', '株距(cm)', '數量(株)', '種植面積(㎡)'],
    ...(boqData || plants).map(p => [
      p.name_zh,
      p.name_latin,
      roleLabel(p.role),
      p.piet_analog || '',
      p.pot_size || '',
      p.spacing_cm || '',
      p.quantity || '',
      p.role_area_m2 || ''
    ])
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(boqRows);
  ws1['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 10 }, { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'BOQ 植栽清單');

  // Sheet 2: 植物屬性
  const attrRows = [
    ['編號', '中文名', '學名', '科別', '角色', 'Piet對應', '高度(cm)', '密度(/m²)', '冬季結構', 'CSR策略', '架構類型', '開花月份', '結構月份'],
    ...plants.map(p => [
      p.id || '',
      p.name_zh,
      p.name_latin,
      p.family_zh || '',
      roleLabel(p.role),
      p.piet_analog || '',
      `${(p.height_cm || [])[0] || ''}-${(p.height_cm || [])[1] || ''}`,
      p.density_per_m2 || '',
      p.winter_structure ? '是' : '否',
      p.csr_strategy || '',
      p.architecture || '',
      (p.bloom_months || []).join(','),
      (p.structural_months || []).join(',')
    ])
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(attrRows);
  ws2['!cols'] = Array(13).fill({ wch: 14 });
  XLSX.utils.book_append_sheet(wb, ws2, '植物屬性表');

  // Sheet 3: 基地條件
  if (siteConditions) {
    const siteRows = [
      ['項目', '數值'],
      ['日照條件', siteConditions.light || ''],
      ['水分條件', siteConditions.moisture || ''],
      ['海拔(m)', siteConditions.altitude || ''],
      ['面積(㎡)', siteConditions.area || ''],
      ['植栽方案', paletteName || '']
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(siteRows);
    ws3['!cols'] = [{ wch: 14 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws3, '基地條件');
  }

  // Download
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `NativePlant_${paletteName || '植栽提案'}_${date}.xlsx`);
}

function roleLabel(role) {
  const map = { matrix: '基質植物', primary: '初級植物', scatter: '散布植物', filler: '填充植物' };
  return map[role] || role;
}

export function saveProjectToStorage(project) {
  const key = `nativeplant_project_${Date.now()}`;
  const existing = JSON.parse(localStorage.getItem('nativeplant_projects') || '[]');
  existing.unshift({ key, ...project, savedAt: new Date().toISOString() });
  localStorage.setItem('nativeplant_projects', JSON.stringify(existing.slice(0, 20)));
  return key;
}

export function loadProjectsFromStorage() {
  return JSON.parse(localStorage.getItem('nativeplant_projects') || '[]');
}
