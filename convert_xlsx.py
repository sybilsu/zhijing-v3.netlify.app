"""Convert 2026_植物屬性表_500種.xlsx → data/plants_enriched.json"""
import json
import re
import openpyxl

def derive_category(longevity, role):
    """Derive Chinese category from LONGEVITY and Role fields."""
    if not longevity:
        return ''
    lo = str(longevity).lower()
    if 'tree' in lo or '喬木' in lo:
        return '喬木'
    if 'shrub' in lo or '灌木' in lo:
        return '灌木'
    if 'grass' in lo or '禾草' in lo or 'graminoid' in lo:
        return '禾草'
    if 'fern' in lo or '蕨類' in lo:
        return '蕨類'
    if 'vine' in lo or '藤本' in lo:
        return '藤本'
    if 'ground' in lo or '地被' in lo:
        return '地被'
    if 'perennial' in lo or '多年生' in lo:
        return '多年生草本'
    if 'annual' in lo or '一年生' in lo:
        return '一年生草本'
    if 'bulb' in lo or '球根' in lo:
        return '球根'
    if 'aquatic' in lo or '水生' in lo:
        return '水生'
    # Fallback from Role
    if role:
        r = str(role).lower()
        if r in ('matrix', 'filler', 'scatter'):
            return '草本'
        if r in ('structure', 'primary'):
            return '灌木'
    return str(longevity)

COLOR_PATTERNS = {
    'white':  ['白', 'white', '乳白'],
    'yellow': ['黃', 'yellow', '金黃', '淡黃'],
    'red':    ['紅', 'red', '緋紅', '朱紅'],
    'pink':   ['粉', 'pink', '粉紅', '桃紅'],
    'purple': ['紫', 'purple', '淡紫', '藍紫'],
    'blue':   ['藍', 'blue'],
    'orange': ['橙', 'orange'],
    'green':  ['綠', 'green'],
    'black':  ['黑', 'black'],
    'brown':  ['棕', '褐', 'brown'],
}

def extract_colors(text, color_type='flower'):
    """Extract colors from NOTES text based on color_type hints."""
    if not text:
        return []
    found = []
    for color_key, keywords in COLOR_PATTERNS.items():
        for kw in keywords:
            if kw in str(text):
                # Use Chinese label
                zh_map = {
                    'white': '白', 'yellow': '黃', 'red': '紅',
                    'pink': '粉', 'purple': '紫', 'blue': '藍',
                    'orange': '橙', 'green': '綠', 'black': '黑', 'brown': '棕'
                }
                if zh_map[color_key] not in found:
                    found.append(zh_map[color_key])
                break
    return found

def safe_str(val):
    if val is None:
        return ''
    return str(val).strip()

def safe_int_or_str(val):
    if val is None:
        return ''
    if isinstance(val, float) and val == int(val):
        return str(int(val))
    return str(val).strip()

wb = openpyxl.load_workbook(
    'C:/Users/g1375/web app/zhijing-v3/taiwan native/2026_植物屬性表_500種.xlsx',
    read_only=True
)
ws = wb.active
rows = list(ws.iter_rows(values_only=True))
headers = list(rows[0])

col = {h: i for i, h in enumerate(headers) if h}

def get(row, header):
    idx = col.get(header)
    if idx is None:
        return None
    if idx >= len(row):
        return None
    return row[idx]

plants = []
for row in rows[1:]:
    name_val = get(row, 'Name (中文名/學名)')
    if not name_val or not str(name_val).strip():
        continue

    no_val = get(row, 'NO.')
    no_str = safe_int_or_str(no_val)

    longevity = safe_str(get(row, 'LONGEVITY (壽命)'))
    role = safe_str(get(row, 'Role (角色)'))
    notes = safe_str(get(row, 'NOTES (備註)'))

    # Photo: use 全株 as primary local filename
    photo_full = safe_str(get(row, '全株 (Photo)'))
    photo_leaf = safe_str(get(row, '葉 (Photo)'))
    photo_closeup = safe_str(get(row, '近景 (Photo)'))
    photo_flower = safe_str(get(row, '花 (Photo)'))

    nm_per_m2 = get(row, 'N/m² (株數)')
    nm_str = safe_int_or_str(nm_per_m2)

    plant = {
        'NO.': no_str,
        'Photo (植物圖)': photo_full,
        'photo_leaf': photo_leaf,
        'photo_closeup': photo_closeup,
        'photo_flower': photo_flower,
        'Name (中文名/學名)': safe_str(name_val),
        'Role (角色)': role,
        'HEIGHT (高度)': safe_str(get(row, 'HEIGHT (高度)')),
        'SPREAD (展幅)': safe_str(get(row, 'SPREAD (展幅)')),
        'N/m² (株數)': nm_str,
        'FOLIAGE (葉形)': safe_str(get(row, 'FOLIAGE (葉形)')),
        'FLW SEASON (花期)': safe_str(get(row, 'FLW SEASON (花期)')),
        'STRUCT INT (結構期)': safe_str(get(row, 'STRUCT INT (結構期)')),
        'LONGEVITY (壽命)': longevity,
        'SPREADING (蔓延)': safe_str(get(row, 'SPREADING (蔓延)')),
        'PERSIST (持久)': safe_str(get(row, 'PERSIST (持久)')),
        'SELF-SOW (自播)': safe_str(get(row, 'SELF-SOW (自播)')),
        'LIGHT (光照)': safe_str(get(row, 'LIGHT (光照)')),
        'SOIL (土壤)': safe_str(get(row, 'SOIL (土壤)')),
        'ZONE (耐寒)': safe_str(get(row, 'ZONE (耐寒)')),
        'NOTES (備註)': notes,
        'category': derive_category(longevity, role),
        'flower_color': extract_colors(notes, 'flower'),
        'leaf_color': ['綠'],
        'fruit_color': [],
    }
    plants.append(plant)

out_path = 'C:/Users/g1375/web app/zhijing-v3/data/plants_enriched.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(plants, f, ensure_ascii=False, indent=2)

print(f'Done: {len(plants)} plants written to {out_path}')
