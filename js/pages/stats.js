import { getMonthSummary } from '../db.js';

const EXPENSE_COLOR = {
  식비: '#f97316', 교통: '#3b82f6', 쇼핑: '#ec4899', 의료: '#10b981',
  '문화/여가': '#8b5cf6', 통신: '#06b6d4', 주거: '#f59e0b', 교육: '#14b8a6', 기타: '#94a3b8',
};

function fmt(n) { return n.toLocaleString('ko-KR') + '원'; }

let year = new Date().getFullYear();
let month = new Date().getMonth() + 1;

export async function renderStats(container) {
  container.innerHTML = `
    <div class="px-4 pt-6">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-2">
          <button id="prev-m" class="text-gray-400 px-1 text-lg">‹</button>
          <h1 class="text-lg font-bold text-gray-800" id="month-title">${year}년 ${month}월</h1>
          <button id="next-m" class="text-gray-400 px-1 text-lg">›</button>
        </div>
      </div>
      <div id="stats-content" class="space-y-4"></div>
    </div>
  `;

  container.querySelector('#prev-m').addEventListener('click', () => changeMonth(-1, container));
  container.querySelector('#next-m').addEventListener('click', () => changeMonth(1, container));

  await loadStats();
}

async function loadStats() {
  const el = document.getElementById('stats-content');
  el.innerHTML = `<div class="bg-white rounded-xl p-4 animate-pulse h-32"></div>`;

  const { income, expense, txs, catExpenses } = await getMonthSummary(year, month);
  const cats = Object.entries(catExpenses).sort((a, b) => b[1] - a[1]);

  if (income === 0 && expense === 0) {
    el.innerHTML = `<p class="text-center text-gray-400 py-10 text-sm">데이터가 없습니다</p>`;
    return;
  }

  // 도넛 차트 (Canvas)
  const donutSvg = cats.length > 0 ? buildDonut(cats, expense) : '';

  el.innerHTML = `
    <!-- 요약 -->
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-blue-50 rounded-xl p-4 text-center">
        <p class="text-xs text-blue-400 mb-1">총 수입</p>
        <p class="text-base font-bold text-blue-600">${fmt(income)}</p>
      </div>
      <div class="bg-red-50 rounded-xl p-4 text-center">
        <p class="text-xs text-red-400 mb-1">총 지출</p>
        <p class="text-base font-bold text-red-500">${fmt(expense)}</p>
      </div>
    </div>

    <!-- 도넛 차트 -->
    ${cats.length > 0 ? `
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <p class="text-sm font-semibold text-gray-700 mb-4">카테고리별 지출</p>
      <div class="flex items-center gap-4">
        <div class="flex-shrink-0">${donutSvg}</div>
        <div class="flex-1 space-y-2">
          ${cats.map(([cat, amt]) => `
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${EXPENSE_COLOR[cat] || '#94a3b8'}"></span>
              <span class="text-xs text-gray-600 flex-1">${cat}</span>
              <span class="text-xs font-semibold text-gray-800">${Math.round(amt / expense * 100)}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    ` : ''}

    <!-- 카테고리 순위 -->
    ${cats.length > 0 ? `
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <p class="text-sm font-semibold text-gray-700 mb-3">지출 상세</p>
      <div class="space-y-3">
        ${cats.map(([cat, amt]) => `
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="text-gray-600">${cat}</span>
              <span class="font-medium text-gray-800">${fmt(amt)}</span>
            </div>
            <div class="bg-gray-100 rounded-full h-1.5">
              <div class="h-1.5 rounded-full" style="width:${Math.round(amt / cats[0][1] * 100)}%;background:${EXPENSE_COLOR[cat] || '#94a3b8'}"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}
  `;
}

function buildDonut(cats, total) {
  const size = 110;
  const cx = size / 2, cy = size / 2, r = 38, stroke = 18;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  const segments = cats.map(([cat, amt]) => {
    const ratio = amt / total;
    const dash = ratio * circumference;
    const gap = circumference - dash;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${EXPENSE_COLOR[cat] || '#94a3b8'}" stroke-width="${stroke}"
      stroke-dasharray="${dash} ${gap}"
      stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${cx} ${cy})" />`;
    offset += dash;
    return seg;
  });

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segments.join('')}</svg>`;
}

async function changeMonth(delta, container) {
  month += delta;
  if (month > 12) { month = 1; year++; }
  if (month < 1) { month = 12; year--; }
  document.getElementById('month-title').textContent = `${year}년 ${month}월`;
  await loadStats();
}
