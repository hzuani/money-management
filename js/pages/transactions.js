import { getMonthTransactions, addTransaction, deleteTransaction, updateTransaction, addTransfer, deleteTransfer, updateTransfer, getAssets, getCategories, addCategory, getUsageCounts, getFixedNames } from '../db.js';
import { typeInfo } from './assets.js';

let EXPENSE_CATS = [];
let INCOME_CATS = [];
let EMOJI = {};
let usageCounts = { categories: {}, assets: {} };

function buildCategoryMaps(categories) {
  EXPENSE_CATS = categories.filter(c => c.type === 'expense');
  INCOME_CATS = categories.filter(c => c.type === 'income');
  EMOJI = Object.fromEntries(categories.map(c => [c.name, c.emoji || '📦']));
}

function fmt(n) { return n.toLocaleString('ko-KR') + '원'; }
function toDateStr(ts) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().split('T')[0];
}
function displayDate(ts) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

let state = { year: new Date().getFullYear(), month: new Date().getMonth() + 1, txs: [] };
let assets = [];
let editing = null;
let selectedType = 'expense';
let selectedCat = '';
let selectedAssetId = '';
let selectedFromAssetId = '';
let selectedToAssetId = '';
let selectedInstallment = 1;
let selectedFixed = false;
let fixedNames = [];

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export async function renderTransactions(container) {
  const [loadedAssets, categories, counts, names] = await Promise.all([getAssets(), getCategories(), getUsageCounts(), getFixedNames()]);
  assets = loadedAssets;
  usageCounts = counts;
  fixedNames = names;
  buildCategoryMaps(categories);
  container.innerHTML = buildShell();
  await loadAndRender(container);
  bindEvents(container);
}

function buildShell() {
  const { year, month } = state;
  return `
    <div class="px-4 pt-6">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <button id="prev-month" class="text-gray-400 px-1 text-lg">‹</button>
          <h1 class="text-lg font-bold text-gray-800">${year}년 ${month}월</h1>
          <button id="next-month" class="text-gray-400 px-1 text-lg">›</button>
        </div>
        <button id="add-btn"
          class="bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow active:bg-indigo-600">
          + 추가
        </button>
      </div>
      <div id="tx-list" class="space-y-2 pb-4"></div>
    </div>

    <!-- 모달 -->
    <div id="modal" class="hidden fixed inset-0 z-50 flex items-end">
      <div class="absolute inset-0 bg-black/40" id="modal-backdrop"></div>
      <div class="relative bg-white rounded-t-2xl w-full max-w-md mx-auto p-6 z-10 max-h-[90vh] overflow-y-auto">
        <h2 id="modal-title" class="text-lg font-bold text-gray-800 mb-4">내역 추가</h2>

        <!-- 수입/지출/이체 탭 -->
        <div class="flex bg-gray-100 rounded-xl p-1 mb-4" id="type-tabs">
          <button data-type="expense" class="type-tab flex-1 py-1.5 rounded-lg text-sm font-medium transition bg-white text-red-500 shadow">지출</button>
          <button data-type="income"  class="type-tab flex-1 py-1.5 rounded-lg text-sm font-medium transition text-gray-400">수입</button>
          <button data-type="transfer" class="type-tab flex-1 py-1.5 rounded-lg text-sm font-medium transition text-gray-400">이체</button>
        </div>

        <!-- 금액 -->
        <div class="mb-3">
          <label class="text-xs text-gray-500 mb-1 block">금액</label>
          <input id="f-amount" type="text" inputmode="numeric" placeholder="0"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold text-gray-800 focus:outline-none focus:border-indigo-400" />
        </div>

        <!-- 날짜 -->
        <div class="mb-3">
          <label class="text-xs text-gray-500 mb-1 block">날짜</label>
          <input id="f-date" type="date"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:border-indigo-400" />
        </div>

        <!-- 수입/지출 전용: 카테고리 -->
        <div id="section-category" class="mb-3">
          <label class="text-xs text-gray-500 mb-1 block">카테고리</label>
          <div id="cat-grid" class="grid grid-cols-4 gap-2"></div>
        </div>

        <!-- 수입/지출 전용: 자산 -->
        <div id="section-asset" class="mb-3">
          <label class="text-xs text-gray-500 mb-1 block">자산 (어느 계좌/지갑에서?)</label>
          <div id="asset-chips" class="flex flex-wrap gap-2"></div>
        </div>

        <!-- 신용카드 지출시: 할부 -->
        <div id="section-installment" class="hidden mb-3">
          <label class="text-xs text-gray-500 mb-2 block">할부</label>
          <div id="installment-content"></div>
        </div>

        <!-- 이체 전용: 보내는 계좌 -->
        <div id="section-from" class="hidden mb-3">
          <label class="text-xs text-gray-500 mb-1 block">보내는 계좌</label>
          <div id="from-chips" class="flex flex-wrap gap-2"></div>
        </div>

        <!-- 이체 전용: 받는 계좌 -->
        <div id="section-to" class="hidden mb-3">
          <label class="text-xs text-gray-500 mb-1 block">받는 계좌</label>
          <div id="to-chips" class="flex flex-wrap gap-2"></div>
        </div>

        <!-- 고정지출 (지출만) -->
        <div id="section-fixed" class="hidden mb-3">
          <label class="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl cursor-pointer">
            <input type="checkbox" id="f-fixed" class="w-5 h-5 rounded accent-indigo-500 flex-shrink-0">
            <div>
              <p class="text-sm font-medium text-gray-700">고정지출로 등록</p>
            </div>
          </label>
          <div id="section-fixed-name" class="hidden mt-2 px-1">
            <label class="text-xs text-gray-500 mb-1 block">고정지출 이름</label>
            <input id="f-fixed-name" type="text" placeholder="예: 실비 보험료, 넷플릭스"
              list="fixed-name-list" autocomplete="off"
              class="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:border-indigo-400" />
            <datalist id="fixed-name-list"></datalist>
            <p class="text-xs text-gray-400 mt-1">이름이 같으면 매달 같은 항목으로 묶입니다</p>
          </div>
        </div>

        <!-- 메모 -->
        <div class="mb-5">
          <label class="text-xs text-gray-500 mb-1 block">메모 (선택)</label>
          <input id="f-memo" type="text" placeholder="메모를 입력하세요"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:border-indigo-400" />
        </div>

        <button id="save-btn" class="w-full bg-indigo-500 text-white font-semibold py-3.5 rounded-xl active:bg-indigo-600">
          저장
        </button>
      </div>
    </div>
  `;
}

async function loadAndRender(container) {
  const listEl = container.querySelector('#tx-list') || document.getElementById('tx-list');
  listEl.innerHTML = `<div class="bg-white rounded-xl p-4 animate-pulse h-14"></div>`.repeat(3);
  state.txs = await getMonthTransactions(state.year, state.month);
  renderList(listEl);
}

function renderList(listEl) {
  if (state.txs.length === 0) {
    listEl.innerHTML = `<p class="text-center text-gray-400 py-10 text-sm">내역이 없습니다</p>`;
    return;
  }
  listEl.innerHTML = state.txs.map(t => {
    const isAuto = !!t.isAutoReward;
    const isTransfer = t.type === 'transfer';

    let icon, label, sub, amountEl;

    if (isTransfer) {
      const fromAsset = assets.find(a => a.id === t.fromAssetId);
      const toAsset = assets.find(a => a.id === t.toAssetId);
      const fromName = fromAsset?.name || t.fromAssetName || '?';
      const toName = toAsset?.name || t.toAssetName || '?';
      icon = '🔄';
      label = `${fromName} → ${toName}`;
      sub = `이체${t.memo ? ' · ' + t.memo : ''}`;
      amountEl = `<span class="text-sm font-bold text-indigo-500 mr-2 whitespace-nowrap">${fmt(t.amount)}</span>`;
    } else {
      const asset = assets.find(a => a.id === t.assetId);
      const assetInfo = asset ? typeInfo(asset.type) : null;
      icon = isAuto ? '🎁' : (EMOJI[t.category] || '📦');
      label = `${t.category}${t.memo ? ' · ' + t.memo : ''}`;
      sub = `${displayDate(t.date)}${assetInfo ? ' · ' + assetInfo.icon + ' ' + asset.name : ''}`;
      const color = t.type === 'income' ? 'text-blue-500' : 'text-red-500';
      const sign = t.type === 'income' ? '+' : '-';
      const hasInst = t.type === 'expense' && t.installment > 1;
      const dispAmt = hasInst ? Math.floor(t.amount / t.installment) : t.amount;
      amountEl = `<div class="text-right mr-2 whitespace-nowrap">
        <span class="text-sm font-bold ${color}">${sign}${fmt(dispAmt)}</span>
        ${hasInst ? `<p class="text-xs text-gray-400">${t.installment}개월 할부</p>` : ''}
      </div>`;
    }

    const actions = isAuto
      ? `<span class="text-xs text-gray-300 px-1">자동</span>`
      : `<button class="edit-btn text-gray-300 p-1" data-id="${t.id}">✏️</button>
         <button class="del-btn text-gray-300 p-1" data-id="${t.id}">🗑️</button>`;

    return `
      <div class="bg-white rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm ${isAuto ? 'opacity-70' : ''}">
        <span class="text-xl w-8 text-center">${icon}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <p class="text-sm font-medium text-gray-800 truncate">${label}</p>
            ${isAuto ? '<span class="text-xs bg-sky-100 text-sky-500 px-1.5 py-0.5 rounded-full flex-shrink-0">자동</span>' : ''}
          </div>
          <p class="text-xs text-gray-400 mt-0.5">${sub}</p>
        </div>
        ${amountEl}
        <div class="flex gap-1">${actions}</div>
      </div>
    `;
  }).join('');
}

function bindEvents(container) {
  container.querySelector('#prev-month').addEventListener('click', () => changeMonth(-1, container));
  container.querySelector('#next-month').addEventListener('click', () => changeMonth(1, container));
  container.querySelector('#add-btn').addEventListener('click', () => openModal());
  document.getElementById('f-amount').addEventListener('input', e => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    e.target.value = raw ? Number(raw).toLocaleString('ko-KR') : '';
  });
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('f-fixed').addEventListener('change', e => {
    const show = e.target.checked;
    document.getElementById('section-fixed-name').classList.toggle('hidden', !show);
    if (show) {
      document.getElementById('fixed-name-list').innerHTML =
        fixedNames.map(n => `<option value="${n}"></option>`).join('');
    }
  });
  document.getElementById('type-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.type-tab');
    if (btn) switchType(btn.dataset.type);
  });
  document.getElementById('save-btn').addEventListener('click', save);

  document.getElementById('tx-list').addEventListener('click', async e => {
    const delBtn = e.target.closest('.del-btn');
    const editBtn = e.target.closest('.edit-btn');
    if (delBtn) {
      if (!confirm('삭제할까요?')) return;
      const tx = state.txs.find(t => t.id === delBtn.dataset.id);
      if (tx.type === 'transfer') await deleteTransfer(tx);
      else await deleteTransaction(tx);
      state.txs = state.txs.filter(t => t.id !== delBtn.dataset.id);
      assets = await getAssets();
      renderList(document.getElementById('tx-list'));
    }
    if (editBtn) {
      const tx = state.txs.find(t => t.id === editBtn.dataset.id);
      if (tx) openModal(tx);
    }
  });
}

function openModal(tx = null) {
  editing = tx;
  document.getElementById('modal-title').textContent = tx ? '내역 수정' : '내역 추가';
  document.getElementById('f-amount').value = tx ? Number(tx.amount).toLocaleString('ko-KR') : '';
  document.getElementById('f-date').value = tx ? toDateStr(tx.date) : localDateStr();
  document.getElementById('f-memo').value = tx ? (tx.memo || '') : '';

  if (tx?.type === 'transfer') {
    selectedFromAssetId = tx.fromAssetId || '';
    selectedToAssetId = tx.toAssetId || '';
    selectedInstallment = 1;
    switchType('transfer');
  } else {
    selectedCat = tx ? tx.category : '';
    selectedAssetId = tx ? (tx.assetId || '') : '';
    selectedInstallment = tx?.installment || 1;
    switchType(tx ? tx.type : 'expense');
  }
  selectedFixed = tx?.isFixed || false;
  document.getElementById('f-fixed').checked = selectedFixed;
  document.getElementById('f-fixed-name').value = tx?.fixedName || '';
  document.getElementById('section-fixed-name').classList.toggle('hidden', !selectedFixed);
  if (selectedFixed) {
    document.getElementById('fixed-name-list').innerHTML =
      fixedNames.map(n => `<option value="${n}"></option>`).join('');
  }
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  editing = null;
}

function switchType(type) {
  selectedType = type;
  const isTransfer = type === 'transfer';

  document.querySelectorAll('.type-tab').forEach(btn => {
    const isActive = btn.dataset.type === type;
    btn.classList.toggle('bg-white', isActive);
    btn.classList.toggle('shadow', isActive);
    btn.classList.toggle('text-gray-400', !isActive);
    if (isActive) {
      btn.classList.remove('text-red-500', 'text-blue-500', 'text-indigo-500');
      if (type === 'expense') btn.classList.add('text-red-500');
      else if (type === 'income') btn.classList.add('text-blue-500');
      else btn.classList.add('text-indigo-500');
    }
  });

  document.getElementById('section-category').classList.toggle('hidden', isTransfer);
  document.getElementById('section-asset').classList.toggle('hidden', isTransfer);
  document.getElementById('section-fixed').classList.toggle('hidden', type === 'income');
  document.getElementById('section-from').classList.toggle('hidden', !isTransfer);
  document.getElementById('section-to').classList.toggle('hidden', !isTransfer);

  if (!isTransfer) {
    renderCatGrid();
    renderAssetChips();
    updateInstallmentVisibility();
  } else {
    renderFromChips();
    renderToChips();
  }
}

function renderCatGrid() {
  const raw = selectedType === 'expense' ? EXPENSE_CATS : INCOME_CATS;
  const cats = [...raw].sort((a, b) =>
    (usageCounts.categories[b.name] || 0) - (usageCounts.categories[a.name] || 0)
  );
  const grid = document.getElementById('cat-grid');
  grid.innerHTML = cats.map(c => `
    <button class="cat-btn py-2 px-1 rounded-xl text-xs font-medium border transition
      ${c.name === selectedCat ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-gray-200 text-gray-600 bg-white'}"
      data-cat="${c.name}">${c.emoji || '📦'} ${c.name}</button>
  `).join('');
  grid.onclick = e => {
    const btn = e.target.closest('.cat-btn');
    if (btn) { selectedCat = btn.dataset.cat; renderCatGrid(); }
  };

  // Quick-add area below grid
  document.getElementById('quick-cat-area')?.remove();
  const section = document.getElementById('section-category');
  const area = document.createElement('div');
  area.id = 'quick-cat-area';
  area.className = 'mt-2';
  area.innerHTML = `
    <button id="qc-trigger" class="text-xs text-indigo-400 font-medium">+ 새 카테고리</button>
    <div id="qc-form" style="display:none" class="gap-2 items-center mt-1">
      <input id="qc-emoji" type="text" placeholder="📦" maxlength="2"
        class="w-12 border border-gray-200 rounded-lg px-2 py-2 text-lg text-center focus:outline-none focus:border-indigo-400" />
      <input id="qc-name" type="text" placeholder="카테고리 이름"
        class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
      <button id="qc-save" class="bg-indigo-500 text-white text-xs font-medium px-3 py-2 rounded-lg whitespace-nowrap active:bg-indigo-600">저장</button>
      <button id="qc-cancel" class="text-gray-300 text-sm px-1">✕</button>
    </div>
  `;
  section.appendChild(area);

  const triggerBtn = area.querySelector('#qc-trigger');
  const formEl = area.querySelector('#qc-form');

  triggerBtn.addEventListener('click', () => {
    triggerBtn.style.display = 'none';
    formEl.style.display = 'flex';
    area.querySelector('#qc-name').focus();
  });

  area.querySelector('#qc-cancel').addEventListener('click', () => {
    triggerBtn.style.display = '';
    formEl.style.display = 'none';
    area.querySelector('#qc-emoji').value = '';
    area.querySelector('#qc-name').value = '';
  });

  const doSave = async () => {
    const emoji = area.querySelector('#qc-emoji').value.trim() || '📦';
    const name = area.querySelector('#qc-name').value.trim();
    if (!name) return;
    const ref = await addCategory({ name, emoji, type: selectedType });
    const newCat = { id: ref.id, name, emoji, type: selectedType };
    if (selectedType === 'expense') EXPENSE_CATS.push(newCat);
    else INCOME_CATS.push(newCat);
    EMOJI[name] = emoji;
    selectedCat = name;
    renderCatGrid();
  };

  area.querySelector('#qc-save').addEventListener('click', doSave);
  area.querySelector('#qc-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSave();
  });
}

function renderInstallmentSection() {
  const el = document.getElementById('installment-content');
  if (!el) return;
  const on = selectedInstallment > 1;
  el.innerHTML = `
    <div class="flex items-center gap-3 mb-2">
      <span class="text-sm ${!on ? 'text-gray-800 font-medium' : 'text-gray-400'}">일시불</span>
      <button id="inst-toggle" class="relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-indigo-500' : 'bg-gray-200'}">
        <span class="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
          style="left:${on ? '1.375rem' : '0.25rem'}"></span>
      </button>
      <span class="text-sm ${on ? 'text-indigo-600 font-medium' : 'text-gray-400'}">할부</span>
    </div>
    ${on ? `<div class="flex flex-wrap gap-1.5">
      ${[2,3,4,5,6,7,8,9,10,11,12].map(n => `
        <button class="inst-chip px-3 py-1.5 rounded-full text-xs font-medium border transition
          ${selectedInstallment === n ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-gray-200 text-gray-500'}"
          data-m="${n}">${n}개월</button>`).join('')}
    </div>` : ''}
  `;
  el.querySelector('#inst-toggle').addEventListener('click', () => {
    selectedInstallment = on ? 1 : 2;
    renderInstallmentSection();
  });
  el.querySelectorAll('.inst-chip').forEach(btn => {
    btn.addEventListener('click', () => { selectedInstallment = Number(btn.dataset.m); renderInstallmentSection(); });
  });
}

function updateInstallmentVisibility() {
  const section = document.getElementById('section-installment');
  if (!section) return;
  const asset = assets.find(a => a.id === selectedAssetId);
  const show = selectedType === 'expense' && asset?.type === 'credit';
  section.classList.toggle('hidden', !show);
  if (!show) { selectedInstallment = 1; return; }
  renderInstallmentSection();
}

function assetChipHtml(assetId, assets, activeId) {
  const noneActive = !activeId;
  const sorted = [...assets].sort((a, b) =>
    (usageCounts.assets[b.id] || 0) - (usageCounts.assets[a.id] || 0)
  );
  return `
    <button class="asset-chip px-3 py-1.5 rounded-full text-xs font-medium border transition
      ${noneActive && assetId === '' ? 'border-gray-400 bg-gray-100 text-gray-700' : 'border-gray-200 text-gray-400'}"
      data-asset-id="">미선택</button>
    ${sorted.map(a => {
      const ti = typeInfo(a.type);
      const isActive = a.id === activeId;
      return `<button class="asset-chip px-3 py-1.5 rounded-full text-xs font-medium border transition
        ${isActive ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-gray-200 text-gray-500'}"
        data-asset-id="${a.id}">${ti.icon} ${a.name}</button>`;
    }).join('')}
  `;
}

function renderAssetChips() {
  const el = document.getElementById('asset-chips');
  if (assets.length === 0) {
    el.innerHTML = `<span class="text-xs text-gray-400">자산 탭에서 먼저 추가하세요</span>`;
    return;
  }
  el.innerHTML = assetChipHtml('', assets, selectedAssetId);
  el.onclick = e => {
    const btn = e.target.closest('.asset-chip');
    if (btn) { selectedAssetId = btn.dataset.assetId; renderAssetChips(); updateInstallmentVisibility(); }
  };
}

function renderFromChips() {
  const el = document.getElementById('from-chips');
  el.innerHTML = assetChipHtml('', assets, selectedFromAssetId);
  el.onclick = e => {
    const btn = e.target.closest('.asset-chip');
    if (btn) { selectedFromAssetId = btn.dataset.assetId; renderFromChips(); }
  };
}

function renderToChips() {
  const el = document.getElementById('to-chips');
  el.innerHTML = assetChipHtml('', assets, selectedToAssetId);
  el.onclick = e => {
    const btn = e.target.closest('.asset-chip');
    if (btn) { selectedToAssetId = btn.dataset.assetId; renderToChips(); }
  };
}

async function save() {
  const amount = document.getElementById('f-amount').value.replace(/,/g, '');
  const date = document.getElementById('f-date').value;
  const memo = document.getElementById('f-memo').value.trim();

  if (!amount || Number(amount) <= 0) return alert('금액을 입력해주세요');
  if (!date) return alert('날짜를 선택해주세요');

  try {
    if (selectedType === 'transfer') {
      if (!selectedFromAssetId && !selectedToAssetId) return alert('보내는/받는 계좌를 선택해주세요');
      const fromAsset = assets.find(a => a.id === selectedFromAssetId);
      const toAsset = assets.find(a => a.id === selectedToAssetId);
      const isFixed = document.getElementById('f-fixed').checked;
      const data = {
        amount, date, memo,
        fromAssetId: selectedFromAssetId || null,
        fromAssetName: fromAsset?.name || '',
        toAssetId: selectedToAssetId || null,
        toAssetName: toAsset?.name || '',
        isFixed,
        fixedName: isFixed ? document.getElementById('f-fixed-name').value.trim() : '',
      };
      if (editing) await updateTransfer(editing.id, editing, data);
      else await addTransfer(data);
    } else {
      if (!selectedCat) return alert('카테고리를 선택해주세요');
      const asset = assets.find(a => a.id === selectedAssetId);
      const data = {
        type: selectedType, amount, date, category: selectedCat, memo,
        assetId: selectedAssetId || null,
        assetName: asset?.name || null,
        installment: selectedInstallment,
        billingCycleStart: (asset?.type === 'credit' && asset?.billingCycleStart) ? asset.billingCycleStart : 1,
        isFixed: document.getElementById('f-fixed').checked,
        fixedName: document.getElementById('f-fixed').checked
          ? document.getElementById('f-fixed-name').value.trim()
          : '',
      };
      const sourceAsset = asset || null;
      if (editing) await updateTransaction(editing.id, editing, data, sourceAsset);
      else await addTransaction(data, sourceAsset);
    }

    closeModal();
    [assets, usageCounts, fixedNames] = await Promise.all([
      getAssets(), getUsageCounts(), getFixedNames(),
    ]);
    state.txs = await getMonthTransactions(state.year, state.month);
    renderList(document.getElementById('tx-list'));
  } catch (e) {
    alert('저장 실패: ' + e.message);
  }
}

async function changeMonth(delta, container) {
  state.month += delta;
  if (state.month > 12) { state.month = 1; state.year++; }
  if (state.month < 1) { state.month = 12; state.year--; }
  container.querySelector('h1').textContent = `${state.year}년 ${state.month}월`;
  await loadAndRender(container);
}
