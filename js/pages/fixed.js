import { getMonthTransactions } from '../db.js';

const now = new Date();
let year = now.getFullYear();
let month = now.getMonth() + 1;

export async function renderFixed(container) {
  await load(container);
}

async function load(container) {
  container.innerHTML = `
    <div class="px-4 pt-6 pb-4">
      <div class="flex items-center justify-between mb-5">
        <button id="prev-month" class="p-2 rounded-xl text-gray-400 hover:bg-gray-100 active:bg-gray-200 transition">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 class="text-xl font-bold text-gray-800">${year}년 ${month}월 고정지출</h1>
        <button id="next-month" class="p-2 rounded-xl text-gray-400 hover:bg-gray-100 active:bg-gray-200 transition">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div id="fixed-summary" class="mb-4"></div>
      <div id="fixed-list" class="space-y-3">
        <div class="bg-white rounded-2xl animate-pulse h-20"></div>
        <div class="bg-white rounded-2xl animate-pulse h-20"></div>
        <div class="bg-white rounded-2xl animate-pulse h-20"></div>
      </div>
    </div>
  `;

  container.querySelector('#prev-month').addEventListener('click', () => {
    month--;
    if (month < 1) { month = 12; year--; }
    load(container);
  });
  container.querySelector('#next-month').addEventListener('click', () => {
    month++;
    if (month > 12) { month = 1; year++; }
    load(container);
  });

  try {
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;

    const [currTxs, prevTxs] = await Promise.all([
      getMonthTransactions(year, month),
      getMonthTransactions(prevYear, prevMonth),
    ]);

    const currFixed = currTxs.filter(t => t.isFixed && t.type !== 'income');
    const prevFixed = prevTxs.filter(t => t.isFixed && t.type !== 'income');

    function groupKey(tx) {
      return tx.fixedName?.trim() || tx.memo?.trim() || tx.category || '기타';
    }

    const prevMap = {};
    for (const tx of prevFixed) {
      const key = groupKey(tx);
      if (!prevMap[key]) prevMap[key] = [];
      prevMap[key].push(tx);
    }

    const currMap = {};
    for (const tx of currFixed) {
      const key = groupKey(tx);
      if (!currMap[key]) currMap[key] = [];
      currMap[key].push(tx);
    }

    const allKeys = [...new Set([...Object.keys(currMap), ...Object.keys(prevMap)])];

    const summaryEl = document.getElementById('fixed-summary');
    const listEl = document.getElementById('fixed-list');

    if (allKeys.length === 0) {
      summaryEl.innerHTML = '';
      listEl.innerHTML = `
        <div class="text-center py-12">
          <p class="text-gray-400 text-sm mb-1">고정지출 내역이 없습니다</p>
          <p class="text-gray-300 text-xs">내역 입력 시 "고정지출로 등록"을 체크하세요</p>
        </div>
      `;
      return;
    }

    const paidKeys = allKeys.filter(k => currMap[k]);
    const unpaidKeys = allKeys.filter(k => !currMap[k]);
    const paidTotal = paidKeys.reduce((s, k) => s + currMap[k].reduce((a, t) => a + t.amount, 0), 0);
    const forecastTotal = unpaidKeys.reduce((s, k) => {
      const prev = prevMap[k];
      return s + (prev ? prev[prev.length - 1].amount : 0);
    }, 0);

    summaryEl.innerHTML = `
      <div class="grid grid-cols-3 gap-3 mb-1">
        <div class="bg-green-50 rounded-xl p-3 text-center">
          <p class="text-xs text-green-500 mb-1">완료</p>
          <p class="text-sm font-bold text-green-600">${paidKeys.length}건</p>
        </div>
        <div class="bg-gray-50 rounded-xl p-3 text-center">
          <p class="text-xs text-gray-400 mb-1">예정</p>
          <p class="text-sm font-bold text-gray-500">${unpaidKeys.length}건</p>
        </div>
        <div class="bg-red-50 rounded-xl p-3 text-center">
          <p class="text-xs text-red-400 mb-1">지출 합계</p>
          <p class="text-sm font-bold text-red-500">${(paidTotal + forecastTotal).toLocaleString('ko-KR')}원</p>
        </div>
      </div>
    `;

    const paidHtml = paidKeys.map(key =>
      currMap[key].map(tx => renderPaidItem(tx, key)).join('')
    ).join('');

    const unpaidHtml = unpaidKeys.map(key => {
      const prev = prevMap[key];
      return renderForecastItem(prev ? prev[prev.length - 1] : null, key);
    }).join('');

    listEl.innerHTML = paidHtml + unpaidHtml;

  } catch (e) {
    console.error(e);
    document.getElementById('fixed-list').innerHTML = `
      <p class="text-center text-red-400 py-6 text-sm">불러오기 실패: ${e.message}</p>
    `;
  }
}

function fmtDate(ts) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function fmt(n) { return Number(n).toLocaleString('ko-KR') + '원'; }

function txMeta(tx, key) {
  const isTransfer = tx.type === 'transfer';
  const sub = isTransfer
    ? [`${tx.fromAssetName || '?'} → ${tx.toAssetName || '?'}`, fmtDate(tx.date)].join(' · ')
    : [tx.category, tx.memo && tx.memo.trim() !== key ? tx.memo : null, fmtDate(tx.date)].filter(Boolean).join(' · ');
  const amountColor = isTransfer ? 'text-indigo-500' : 'text-red-500';
  const amountPrefix = isTransfer ? '' : '-';
  return { sub, amountColor, amountPrefix };
}

function renderPaidItem(tx, key) {
  const { sub, amountColor, amountPrefix } = txMeta(tx, key);
  return `
    <div class="bg-white rounded-2xl p-4 shadow-sm border border-green-100">
      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-sm font-semibold text-gray-800 truncate">${key}</p>
            <span class="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex-shrink-0">완료</span>
          </div>
          <p class="text-xs text-gray-400 mt-0.5 truncate">${sub}</p>
        </div>
        <span class="text-sm font-bold ${amountColor} whitespace-nowrap ml-2">${amountPrefix}${fmt(tx.amount)}</span>
      </div>
    </div>
  `;
}

function renderForecastItem(ref, key) {
  let sub = key, amountStr = '-';
  if (ref) {
    const meta = txMeta(ref, key);
    const subParts = ref.type === 'transfer'
      ? [`${ref.fromAssetName || '?'} → ${ref.toAssetName || '?'}`, `지난달 ${fmtDate(ref.date)} 기준`]
      : [ref.category, ref.memo && ref.memo.trim() !== key ? ref.memo : null, `지난달 ${fmtDate(ref.date)} 기준`].filter(Boolean);
    sub = subParts.join(' · ');
    amountStr = `${meta.amountPrefix}${fmt(ref.amount)}`;
  }
  return `
    <div class="bg-white rounded-2xl p-4 shadow-sm border border-dashed border-gray-200 opacity-60">
      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-sm font-semibold text-gray-600 truncate">${key}</p>
            <span class="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">예정</span>
          </div>
          <p class="text-xs text-gray-400 mt-0.5 truncate">${sub}</p>
        </div>
        <span class="text-sm font-bold text-gray-400 whitespace-nowrap ml-2">${amountStr}</span>
      </div>
    </div>
  `;
}
