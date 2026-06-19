import { getAssets, addAsset, updateAsset, deleteAsset, swapAssetOrder, addTransfer, getCardPayments } from '../db.js';

const ASSET_TYPES = [
  { value: 'bank',       label: '은행계좌',  color: '#3b82f6', bg: '#eff6ff' },
  { value: 'cash',       label: '현금',      color: '#10b981', bg: '#f0fdf4' },
  { value: 'credit',     label: '신용카드',  color: '#ef4444', bg: '#fef2f2' },
  { value: 'debit',      label: '체크카드',  color: '#8b5cf6', bg: '#f5f3ff' },
  { value: 'prepaid',    label: '충전카드',  color: '#0ea5e9', bg: '#f0f9ff' },
  { value: 'reward',     label: '적립금',    color: '#f97316', bg: '#fff7ed' },
  { value: 'investment', label: '투자계좌',  color: '#f59e0b', bg: '#fffbeb' },
  { value: 'savings',    label: '적금',      color: '#ec4899', bg: '#fdf2f8' },
  { value: 'housing',    label: '주택청약',  color: '#6366f1', bg: '#eef2ff' },
];

export function typeInfo(value) {
  return ASSET_TYPES.find(t => t.value === value) || ASSET_TYPES[0];
}

const ASSET_GROUPS = [
  { label: '은행/현금', types: ['bank', 'cash'] },
  { label: '카드', types: ['credit', 'debit', 'prepaid'] },
  { label: '투자/저축', types: ['investment', 'savings', 'housing'] },
];

// 순서 이동은 같은 화면 그룹(예: 카드) 안에서 동작해야 한다 (단일 type만 비교하면 비교 대상이 없을 수 있음)
function groupTypesFor(type) {
  const g = ASSET_GROUPS.find(g => g.types.includes(type));
  return g ? g.types : [type];
}

function fmt(n) {
  const abs = Math.abs(n).toLocaleString('ko-KR');
  return (n < 0 ? '-' : '') + abs + '원';
}

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

let assets = [];
let editing = null;
let selectedType = 'bank';
let payingAsset = null;

export async function renderAssets(container) {
  container.innerHTML = buildShell();
  await load();
  bindEvents(container);
}

function buildShell() {
  return `
    <div class="px-4 pt-6">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-xl font-bold text-gray-800">자산 관리</h1>
        <button id="add-asset-btn"
          class="bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow active:bg-indigo-600">
          + 추가
        </button>
      </div>

      <div class="bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl p-4 text-white mb-5">
        <p class="text-indigo-100 text-sm mb-1">총 순자산</p>
        <p id="net-worth-value" class="text-2xl font-bold">계산 중...</p>
      </div>

      <div id="asset-list" class="space-y-3 pb-4"></div>
    </div>

    <!-- 모달 -->
    <div id="asset-modal" class="hidden fixed inset-0 z-50 flex items-end">
      <div class="absolute inset-0 bg-black/40" id="asset-modal-backdrop"></div>
      <div class="relative bg-white rounded-t-2xl w-full max-w-md mx-auto p-6 z-10 max-h-[90vh] overflow-y-auto">
        <h2 id="asset-modal-title" class="text-lg font-bold text-gray-800 mb-4">자산 추가</h2>

        <!-- 종류 -->
        <div class="mb-4">
          <label class="text-xs text-gray-500 mb-2 block">자산 종류</label>
          <div class="grid grid-cols-4 gap-2" id="type-grid">
            ${ASSET_TYPES.map(t => `
              <button class="type-btn flex items-center justify-center py-2.5 rounded-xl border border-gray-200 text-xs font-medium text-gray-600" data-type="${t.value}">
                ${t.label}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 이름 -->
        <div class="mb-3">
          <label class="text-xs text-gray-500 mb-1 block" id="name-label">이름</label>
          <input id="a-name" type="text" placeholder="자산 이름"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:border-indigo-400" />
        </div>

        <!-- 잔액 -->
        <div class="mb-3">
          <label class="text-xs text-gray-500 mb-1 block" id="balance-label">현재 잔액</label>
          <input id="a-balance" type="number" inputmode="numeric" placeholder="0"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold text-gray-800 focus:outline-none focus:border-indigo-400" />
          <p id="balance-hint" class="text-xs text-gray-400 mt-1 hidden"></p>
        </div>

        <!-- 신용/체크카드 전용 -->
        <div id="card-fields" class="hidden space-y-3 mb-3 p-3 rounded-xl">
          <p id="card-fields-title" class="text-xs font-semibold"></p>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">연결된 은행 계좌</label>
            <select id="a-linked-bank" class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 bg-white focus:outline-none focus:border-indigo-400">
              <option value="">선택 안 함</option>
            </select>
          </div>
          <div id="credit-only-fields" class="hidden space-y-3">
            <div>
              <label class="text-xs text-gray-500 mb-1 block">결제일 (매월 며칠)</label>
              <input id="a-payment-day" type="number" inputmode="numeric" min="1" max="31" placeholder="예: 25"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
            </div>
            <div>
              <label class="text-xs text-gray-500 mb-1 block">결제기간 시작일 (매월 며칠부터)</label>
              <input id="a-billing-start" type="number" inputmode="numeric" min="1" max="28" placeholder="예: 9 (현대카드), 5 (국민카드)"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
              <p class="text-xs text-gray-400 mt-1">이 날짜부터 다음 달 하루 전까지가 이번 달 결제금액</p>
            </div>
            <div>
              <label class="text-xs text-gray-500 mb-1 block">신용 한도 (선택)</label>
              <input id="a-credit-limit" type="number" inputmode="numeric" placeholder="0"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
            </div>
          </div>
        </div>

        <!-- 충전카드 전용 -->
        <div id="prepaid-fields" class="hidden space-y-3 mb-3 p-3 rounded-xl" style="background:#f0f9ff">
          <p class="text-xs font-semibold" style="color:#0ea5e9">충전카드 설정</p>

          <div>
            <label class="text-xs text-gray-500 mb-1 block">적립률 (%)</label>
            <div class="flex items-center gap-2">
              <input id="a-reward-rate" type="number" inputmode="numeric" min="0" max="100" placeholder="10"
                class="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:border-sky-400" />
              <span class="text-gray-500 text-sm font-medium">%</span>
            </div>
          </div>

          <div class="flex items-center justify-between py-1">
            <div>
              <p class="text-sm text-gray-700 font-medium">적립금 자동 추적</p>
              <p class="text-xs text-gray-400">지출 시 적립금 내역 자동 생성</p>
            </div>
            <button id="reward-toggle" data-on="false"
              class="w-12 h-6 rounded-full transition-colors duration-200 bg-gray-200 relative flex-shrink-0">
              <span class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"></span>
            </button>
          </div>

          <div id="reward-asset-row" class="hidden">
            <label class="text-xs text-gray-500 mb-1 block">적립금 자산</label>
            <p class="text-xs text-sky-600 bg-sky-50 rounded-xl px-3 py-2" id="reward-asset-info">
              저장 시 "<span id="reward-asset-name-preview">이름</span> 적립금" 자산이 자동으로 생성됩니다
            </p>
          </div>
        </div>

        <button id="asset-save-btn" class="w-full bg-indigo-500 text-white font-semibold py-3.5 rounded-xl active:bg-indigo-600">
          저장
        </button>
      </div>
    </div>

    <!-- 카드값 결제 모달 -->
    <div id="pay-modal" class="hidden fixed inset-0 z-50 flex items-end">
      <div class="absolute inset-0 bg-black/40" id="pay-modal-backdrop"></div>
      <div class="relative bg-white rounded-t-2xl w-full max-w-md mx-auto p-6 z-10">
        <h2 class="text-lg font-bold text-gray-800 mb-1">카드값 결제</h2>
        <p id="pay-modal-desc" class="text-sm text-gray-400 mb-4"></p>

        <div class="mb-3">
          <label class="text-xs text-gray-500 mb-1 block">결제 금액</label>
          <input id="pay-amount" type="text" inputmode="numeric" placeholder="0"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold text-gray-800 focus:outline-none focus:border-indigo-400" />
        </div>
        <div class="mb-5">
          <label class="text-xs text-gray-500 mb-1 block">결제일</label>
          <input id="pay-date" type="date"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:border-indigo-400" />
        </div>

        <button id="pay-confirm-btn" class="w-full bg-indigo-500 text-white font-semibold py-3.5 rounded-xl active:bg-indigo-600">
          결제 처리
        </button>
      </div>
    </div>
  `;
}

async function load() {
  assets = await getAssets();
  renderList();
  updateNetWorth();
}

// 적립금 자산은 부모 바로 아래에 오도록 표시 순서 정렬
function getDisplayOrder(assets) {
  const rewardIds = new Set(assets.filter(a => a.rewardAssetId).map(a => a.rewardAssetId));
  const result = [];
  for (const a of assets) {
    if (rewardIds.has(a.id)) continue;
    result.push(a);
    if (a.rewardAssetId) {
      const reward = assets.find(b => b.id === a.rewardAssetId);
      if (reward) result.push(reward);
    }
  }
  return result;
}

function renderAssetItem(a, rewardIds, movableInGroup) {
  const t = typeInfo(a.type);
  const isCredit = a.type === 'credit';
  const isDebit = a.type === 'debit';
  const isPrepaid = a.type === 'prepaid';
  const isReward = rewardIds.has(a.id);
  const linkedBank = a.linkedBankId ? assets.find(b => b.id === a.linkedBankId) : null;
  // 체크카드는 연결된 계좌가 있으면 그 계좌 잔액을 그대로 보여준다 (카드 자체는 잔액을 안 가짐)
  const displayBalance = (isDebit && linkedBank) ? linkedBank.balance : a.balance;
  const balanceColor = isCredit ? 'text-red-500' : (displayBalance >= 0 ? 'text-gray-800' : 'text-red-500');

  let subInfo = t.label;
  if (isCredit || isDebit) {
    const parts = [];
    if (linkedBank) parts.push(`${linkedBank.name} 연결`);
    if (isCredit && a.billingCycleStart) {
      const endDay = a.billingCycleStart - 1 || 31;
      parts.push(`${a.billingCycleStart}일~${endDay}일 결제기간`);
    }
    if (isCredit && a.paymentDay) parts.push(`매월 ${a.paymentDay}일 결제`);
    if (isCredit && a.creditLimit) parts.push(`한도 ${fmt(a.creditLimit)}`);
    if (parts.length) subInfo = parts.join(' · ');
  } else if (isPrepaid) {
    const parts = ['충전금'];
    if (a.rewardRate) parts.push(`적립률 ${a.rewardRate}%`);
    subInfo = parts.join(' · ');
  }

  const movableIdx = movableInGroup.findIndex(m => m.id === a.id);
  const canUp = !isReward && movableIdx > 0;
  const canDown = !isReward && movableIdx < movableInGroup.length - 1;

  const orderBtns = isReward ? '' : `
    <button class="move-up text-gray-300 p-1 ${canUp ? '' : 'opacity-30 pointer-events-none'}" data-id="${a.id}">▲</button>
    <button class="move-down text-gray-300 p-1 ${canDown ? '' : 'opacity-30 pointer-events-none'}" data-id="${a.id}">▼</button>
  `;

  const payBtn = (isCredit && a.linkedBankId)
    ? `<button class="pay-card w-full mt-2 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg py-2" data-id="${a.id}">카드값 결제</button>`
    : '';

  return `
    <div class="bg-white rounded-2xl px-4 py-3.5 shadow-sm ${isReward ? 'ml-5 border-l-2 border-sky-200' : ''}">
      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-800">${a.name}</p>
          <p class="text-xs text-gray-400 truncate">${subInfo}</p>
        </div>
        <span class="text-sm font-bold ${balanceColor} mr-1">${fmt(displayBalance)}</span>
        <div class="flex flex-col">${orderBtns}</div>
        <div class="flex gap-1">
          <button class="edit-asset text-xs text-gray-400 px-1.5" data-id="${a.id}">수정</button>
          <button class="del-asset text-xs text-gray-400 px-1.5" data-id="${a.id}">삭제</button>
        </div>
      </div>
      ${payBtn}
    </div>
  `;
}

// 종류별로 묶어서 표시 (적립금은 부모 카드가 속한 그룹에 함께 표시)
function buildGroups(displayed) {
  const groups = ASSET_GROUPS.map(g => ({ ...g, items: [] }));
  let lastIdx = 0;
  for (const a of displayed) {
    let idx = groups.findIndex(g => g.types.includes(a.type));
    if (idx === -1) idx = lastIdx;
    groups[idx].items.push(a);
    lastIdx = idx;
  }
  return groups.filter(g => g.items.length > 0);
}

function renderList() {
  const el = document.getElementById('asset-list');
  if (assets.length === 0) {
    el.innerHTML = `<p class="text-center text-gray-400 py-10 text-sm">자산을 추가해보세요</p>`;
    return;
  }

  const displayed = getDisplayOrder(assets);
  const rewardIds = new Set(assets.filter(a => a.rewardAssetId).map(a => a.rewardAssetId));
  const groups = buildGroups(displayed);

  el.innerHTML = groups.map(group => {
    const movableInGroup = group.items.filter(a => !rewardIds.has(a.id));
    const itemsHtml = group.items.map(a => renderAssetItem(a, rewardIds, movableInGroup)).join('');
    return `
      <div class="mb-5">
        <h2 class="text-xs font-semibold text-gray-400 px-1 mb-2">${group.label}</h2>
        <div class="space-y-3">${itemsHtml}</div>
      </div>
    `;
  }).join('');
}

async function moveAsset(id, dir) {
  const a = assets.find(x => x.id === id);
  if (!a) return;
  const rewardIds = new Set(assets.filter(x => x.rewardAssetId).map(x => x.rewardAssetId));
  const groupTypes = groupTypesFor(a.type);
  const sameGroup = assets
    .filter(x => groupTypes.includes(x.type) && !rewardIds.has(x.id))
    .sort((x, y) => (x.sortOrder ?? x.createdAt?.seconds ?? 0) - (y.sortOrder ?? y.createdAt?.seconds ?? 0));
  const idx = sameGroup.findIndex(x => x.id === id);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= sameGroup.length) return;
  await swapAssetOrder(sameGroup[idx], sameGroup[swapIdx]);
  assets = await getAssets();
  renderList();
}

function updateNetWorth() {
  // 연결된 계좌가 있는 체크카드는 그 계좌 잔액에 이미 포함되므로 중복 제외
  const total = assets.reduce((s, a) => {
    if (a.type === 'debit' && a.linkedBankId) return s;
    return s + a.balance;
  }, 0);
  document.getElementById('net-worth-value').textContent = fmt(total);
}

function bindEvents(container) {
  container.querySelector('#add-asset-btn').addEventListener('click', () => openModal());
  document.getElementById('asset-modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('asset-save-btn').addEventListener('click', save);

  document.getElementById('pay-modal-backdrop').addEventListener('click', closePayModal);
  document.getElementById('pay-confirm-btn').addEventListener('click', confirmPayment);
  document.getElementById('pay-amount').addEventListener('input', e => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    e.target.value = raw ? Number(raw).toLocaleString('ko-KR') : '';
  });

  document.getElementById('type-grid').addEventListener('click', e => {
    const btn = e.target.closest('.type-btn');
    if (btn) selectType(btn.dataset.type);
  });

  document.getElementById('reward-toggle').addEventListener('click', toggleReward);

  document.getElementById('a-name').addEventListener('input', e => {
    document.getElementById('reward-asset-name-preview').textContent = e.target.value || '이름';
  });

  document.getElementById('asset-list').addEventListener('click', async e => {
    const del = e.target.closest('.del-asset');
    const edit = e.target.closest('.edit-asset');
    const up = e.target.closest('.move-up');
    const down = e.target.closest('.move-down');
    const pay = e.target.closest('.pay-card');

    if (pay) {
      const a = assets.find(a => a.id === pay.dataset.id);
      if (a) await openPayModal(a);
      return;
    }

    if (del) {
      if (!confirm('자산을 삭제할까요?')) return;
      await deleteAsset(del.dataset.id);
      assets = assets.filter(a => a.id !== del.dataset.id);
      renderList();
      updateNetWorth();
    }
    if (edit) {
      const a = assets.find(a => a.id === edit.dataset.id);
      if (a) openModal(a);
    }
    if (up || down) {
      const id = (up || down).dataset.id;
      await moveAsset(id, up ? -1 : 1);
    }
  });
}

function toggleReward() {
  const btn = document.getElementById('reward-toggle');
  const isOn = btn.dataset.on === 'true';
  setRewardToggle(!isOn);
}

function setRewardToggle(on) {
  const btn = document.getElementById('reward-toggle');
  btn.dataset.on = String(on);
  btn.style.background = on ? '#0ea5e9' : '';
  btn.querySelector('span').style.transform = on ? 'translateX(24px)' : '';
  document.getElementById('reward-asset-row').classList.toggle('hidden', !on);
}

function openModal(asset = null) {
  editing = asset;
  document.getElementById('asset-modal-title').textContent = asset ? '자산 수정' : '자산 추가';
  document.getElementById('a-name').value = asset ? asset.name : '';
  document.getElementById('a-balance').value = asset ? Math.abs(asset.balance) : '';
  document.getElementById('a-payment-day').value = asset?.paymentDay || '';
  document.getElementById('a-billing-start').value = asset?.billingCycleStart || '';
  document.getElementById('a-credit-limit').value = asset?.creditLimit || '';
  document.getElementById('a-reward-rate').value = asset?.rewardRate ?? 10;
  document.getElementById('reward-asset-name-preview').textContent = asset?.name || '이름';
  setRewardToggle(!!asset?.rewardAssetId);
  selectType(asset ? asset.type : 'bank');
  if (asset?.linkedBankId) {
    document.getElementById('a-linked-bank').value = asset.linkedBankId;
  }
  document.getElementById('asset-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('asset-modal').classList.add('hidden');
  editing = null;
}

async function openPayModal(asset) {
  payingAsset = asset;
  const bank = assets.find(b => b.id === asset.linkedBankId);

  const now = new Date();
  let suggested = 0;
  try {
    const payments = await getCardPayments(now.getFullYear(), now.getMonth() + 1);
    suggested = payments.find(p => p.assetId === asset.id)?.amount || 0;
  } catch (e) {
    console.error(e);
  }

  document.getElementById('pay-modal-desc').textContent =
    `${bank?.name || '연결 계좌'}에서 ${asset.name} 대금을 결제 처리합니다`;
  document.getElementById('pay-amount').value = suggested ? suggested.toLocaleString('ko-KR') : '';
  document.getElementById('pay-date').value = localDateStr();
  document.getElementById('pay-modal').classList.remove('hidden');
}

function closePayModal() {
  document.getElementById('pay-modal').classList.add('hidden');
  payingAsset = null;
}

async function confirmPayment() {
  const amount = document.getElementById('pay-amount').value.replace(/,/g, '');
  const date = document.getElementById('pay-date').value;
  if (!amount || Number(amount) <= 0) return alert('금액을 입력해주세요');
  if (!date) return alert('날짜를 선택해주세요');
  if (!payingAsset?.linkedBankId) return alert('연결된 계좌가 없습니다');

  const bank = assets.find(b => b.id === payingAsset.linkedBankId);
  try {
    await addTransfer({
      amount, date,
      fromAssetId: payingAsset.linkedBankId,
      fromAssetName: bank?.name || '',
      toAssetId: payingAsset.id,
      toAssetName: payingAsset.name,
      memo: '카드값 결제',
    });
    closePayModal();
    assets = await getAssets();
    renderList();
    updateNetWorth();
  } catch (e) {
    alert('결제 처리 실패: ' + e.message);
  }
}

function selectType(type) {
  selectedType = type;
  document.querySelectorAll('.type-btn').forEach(btn => {
    const t = typeInfo(btn.dataset.type);
    const isActive = btn.dataset.type === type;
    btn.style.borderColor = isActive ? t.color : '';
    btn.style.background = isActive ? t.bg : '';
    btn.style.color = isActive ? t.color : '';
  });

  const isCredit = type === 'credit';
  const isDebit = type === 'debit';
  const isCard = isCredit || isDebit;
  const isPrepaid = type === 'prepaid';

  document.getElementById('balance-hint').classList.toggle('hidden', !isCredit);
  if (isCredit) {
    document.getElementById('balance-hint').textContent = '현재 사용 중인 금액을 입력하세요';
  }
  document.getElementById('balance-label').textContent = isCredit ? '현재 사용 금액' : '현재 잔액';
  document.getElementById('name-label').textContent = isPrepaid ? '이름 (예: 동백전, 경기지역화폐)' : '이름 (예: 국민은행, 지갑)';

  // 카드 필드
  const cardFields = document.getElementById('card-fields');
  cardFields.classList.toggle('hidden', !isCard);
  if (isCard) {
    const t = typeInfo(type);
    cardFields.style.background = t.bg;
    document.getElementById('card-fields-title').textContent = isCredit ? '신용카드 정보' : '체크카드 정보';
    document.getElementById('card-fields-title').style.color = t.color;
    document.getElementById('credit-only-fields').classList.toggle('hidden', !isCredit);
    const bankAssets = assets.filter(a => a.type === 'bank');
    const select = document.getElementById('a-linked-bank');
    select.innerHTML = `<option value="">선택 안 함</option>` +
      bankAssets.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  }

  // 충전카드 필드
  document.getElementById('prepaid-fields').classList.toggle('hidden', !isPrepaid);
}

async function save() {
  const name = document.getElementById('a-name').value.trim();
  const balanceInput = Number(document.getElementById('a-balance').value);

  if (!name) return alert('이름을 입력해주세요');
  if (isNaN(balanceInput)) return alert('잔액을 입력해주세요');

  const balance = selectedType === 'credit' ? -Math.abs(balanceInput) : balanceInput;
  const data = { name, type: selectedType, balance };

  if (selectedType === 'credit' || selectedType === 'debit') {
    const linkedBankId = document.getElementById('a-linked-bank').value;
    if (linkedBankId) data.linkedBankId = linkedBankId;
    if (selectedType === 'credit') {
      const paymentDay = Number(document.getElementById('a-payment-day').value);
      const billingCycleStart = Number(document.getElementById('a-billing-start').value);
      const creditLimit = Number(document.getElementById('a-credit-limit').value);
      if (paymentDay) data.paymentDay = paymentDay;
      if (billingCycleStart) data.billingCycleStart = billingCycleStart;
      if (creditLimit) data.creditLimit = creditLimit;
    }
  }

  if (selectedType === 'prepaid') {
    const rewardRate = Number(document.getElementById('a-reward-rate').value) || 0;
    data.rewardRate = rewardRate;

    const rewardOn = document.getElementById('reward-toggle').dataset.on === 'true';
    if (rewardOn) {
      // 수정 시 기존 rewardAssetId 유지, 새 자산이면 자동 생성
      if (editing?.rewardAssetId) {
        data.rewardAssetId = editing.rewardAssetId;
      } else {
        // 적립금 자산 자동 생성 (부모 바로 다음 순서)
        const parentOrder = Date.now();
        const rewardRef = await addAsset({
          name: `${name} 적립금`,
          type: 'reward',
          balance: 0,
        }, parentOrder + 1);
        data.rewardAssetId = rewardRef.id;
        assets.push({ id: rewardRef.id, name: `${name} 적립금`, type: 'savings', balance: 0 });
      }
    } else {
      data.rewardAssetId = null;
    }
  }

  try {
    if (editing) {
      await updateAsset(editing.id, data);
      const idx = assets.findIndex(a => a.id === editing.id);
      assets[idx] = { ...assets[idx], ...data };
    } else {
      const ref = await addAsset(data);
      assets.push({ id: ref.id, ...data });
    }
    closeModal();
    renderList();
    updateNetWorth();
  } catch (e) {
    alert('저장 실패: ' + e.message);
  }
}

export { assets as cachedAssets };
