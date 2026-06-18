import { getMonthSummary, getCardPayments } from '../db.js';

function fmt(n) { return n.toLocaleString('ko-KR') + '원'; }
function fmtSigned(n) { return (n >= 0 ? '+' : '') + n.toLocaleString('ko-KR') + '원'; }

export async function renderDashboard(container) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  container.innerHTML = `
    <div class="px-4 pt-6 pb-4">
      <div class="flex items-center justify-between mb-5">
        <h1 class="text-xl font-bold text-gray-800">${year}년 ${month}월</h1>
        <span class="text-sm text-gray-400">${now.toLocaleDateString('ko-KR', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      </div>

      <!-- 이번 달 요약 -->
      <div id="summary-cards" class="space-y-3 mb-5">
        <div class="bg-indigo-100 rounded-2xl animate-pulse h-24"></div>
      </div>

      <!-- 카드별 사용액 -->
      <h2 class="font-semibold text-gray-700 mb-3">이번 달 카드별 사용액</h2>
      <div id="asset-usage-list" class="space-y-2">
        <div class="bg-white rounded-xl p-4 animate-pulse h-14"></div>
        <div class="bg-white rounded-xl p-4 animate-pulse h-14"></div>
      </div>
    </div>
  `;

  try {
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;

    const [{ income, expense, txs, assetExpenses }, cardPayments] = await Promise.all([
      getMonthSummary(year, month),
      getCardPayments(nextYear, nextMonth),
    ]);

    // 이번 달 요약
    const balance = income - expense;
    const cardSection = cardPayments.length > 0 ? `
      <div class="bg-amber-50 border border-amber-100 rounded-2xl p-4">
        <p class="text-xs font-semibold text-amber-600 mb-2">${nextMonth}월 카드 결제 예정</p>
        ${cardPayments.map(c => `
          <div class="flex justify-between items-center py-0.5">
            <span class="text-sm text-gray-600">${c.assetName}</span>
            <span class="text-sm font-bold text-amber-700">${fmt(c.amount)}</span>
          </div>
        `).join('')}
      </div>` : '';

    document.getElementById('summary-cards').innerHTML = `
      <div class="bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl p-4 text-white">
        <p class="text-indigo-100 text-sm mb-1">이번 달 수지</p>
        <p class="text-2xl font-bold">${fmtSigned(balance)}</p>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div class="bg-blue-50 rounded-xl p-3 text-center">
          <p class="text-xs text-blue-400 mb-1">수입</p>
          <p class="text-sm font-bold text-blue-600">${fmt(income)}</p>
        </div>
        <div class="bg-red-50 rounded-xl p-3 text-center">
          <p class="text-xs text-red-400 mb-1">지출</p>
          <p class="text-sm font-bold text-red-500">${fmt(expense)}</p>
        </div>
        <div class="bg-gray-50 rounded-xl p-3 text-center">
          <p class="text-xs text-gray-400 mb-1">건수</p>
          <p class="text-sm font-bold text-gray-600">${txs.length}건</p>
        </div>
      </div>
      ${cardSection}
    `;

    // 카드별 사용액
    const usageList = Object.values(assetExpenses).sort((a, b) => b.amount - a.amount);
    const listEl = document.getElementById('asset-usage-list');
    if (usageList.length === 0) {
      listEl.innerHTML = `<p class="text-center text-gray-400 py-6 text-sm">이번 달 지출 내역이 없습니다</p>`;
    } else {
      listEl.innerHTML = usageList.map(a => `
        <div class="bg-white rounded-xl px-4 py-3 flex items-center justify-between shadow-sm">
          <span class="text-sm font-medium text-gray-800">${a.assetName || '미지정'}</span>
          <span class="text-sm font-bold text-red-500">${fmt(a.amount)}</span>
        </div>
      `).join('');
    }
  } catch (e) {
    console.error(e);
  }
}
