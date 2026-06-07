const SPACING_MAP = {
  matrix:  { '3吋': 25, '4吋': 30, '5吋': 35 },
  primary: { '3吋': 40, '4吋': 45, '5吋': 55 },
  scatter: { '3吋': 70, '4吋': 80, '5吋': 90 },
  filler:  { '3吋': 25, '4吋': 30, '5吋': 35 }
};

const ROLE_PCTS = { matrix: 0.50, primary: 0.30, scatter: 0.10, filler: 0.10 };

export function calculateBOQ(areaSqm, plants, potSize) {
  return plants.map(plant => {
    const role = plant.role || 'matrix';
    const spacingCm = SPACING_MAP[role]?.[potSize] || 40;
    const spacingM = spacingCm / 100;
    const plantsPerM2 = 1 / (spacingM * spacingM);
    const roleArea = areaSqm * (ROLE_PCTS[role] || 0.1);
    const quantity = Math.ceil(roleArea * plantsPerM2 * (plant.ratio_pct ? plant.ratio_pct / 100 : 1));

    return {
      ...plant,
      spacing_cm: spacingCm,
      quantity,
      pot_size: potSize,
      role_area_m2: Math.round(roleArea * 10) / 10
    };
  });
}

export function initMatrix(getPaletteData) {
  const areaInput = document.getElementById('matrix-area');
  const potSelect = document.getElementById('matrix-pot');
  const tableBody = document.getElementById('boq-tbody');
  const totalQtyEl = document.getElementById('total-qty');
  const totalAreaEl = document.getElementById('total-area');

  function update() {
    const area = parseFloat(areaInput?.value || 100);
    const pot = potSelect?.value || '5吋';
    const paletteData = getPaletteData();

    if (!paletteData || !paletteData.plants) {
      if (tableBody) tableBody.innerHTML = '<tr><td colspan="7" class="empty-row">請先完成植栽提案分析</td></tr>';
      return;
    }

    const boq = calculateBOQ(area, paletteData.plants, pot);
    renderBOQ(boq, area);

    if (totalAreaEl) totalAreaEl.textContent = area + ' ㎡';
  }

  function renderBOQ(boq, area) {
    if (!tableBody) return;

    const roleLabels = { matrix: '基質', primary: '初級', scatter: '散布', filler: '填充' };
    let totalQty = 0;

    tableBody.innerHTML = boq.map(item => {
      totalQty += item.quantity;
      return `
        <tr class="boq-row role-${item.role}">
          <td><span class="plant-zh">${item.name_zh}</span><br><em class="plant-latin">${item.name_latin}</em></td>
          <td><span class="role-badge role-${item.role}">${roleLabels[item.role] || item.role}</span></td>
          <td>${item.pot_size}</td>
          <td>${item.spacing_cm} cm</td>
          <td>${item.role_area_m2} ㎡</td>
          <td class="qty-cell">${item.quantity} 株</td>
          <td><span class="piet-ref">${item.piet_analog || '-'}</span></td>
        </tr>
      `;
    }).join('');

    if (totalQtyEl) totalQtyEl.textContent = totalQty + ' 株';
  }

  if (areaInput) areaInput.addEventListener('input', update);
  if (potSelect) potSelect.addEventListener('change', update);

  return { update };
}
