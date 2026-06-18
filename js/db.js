import { db } from './firebase.js';
import { currentUser } from './auth.js';
import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  getDoc,
  setDoc,
  doc,
  query,
  where,
  orderBy,
  getDocs,
  writeBatch,
  increment,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

function userCol(name) {
  return collection(db, 'users', currentUser().uid, name);
}

function assetDocRef(id) {
  return doc(db, 'users', currentUser().uid, 'assets', id);
}

function txDocRef(id) {
  return doc(db, 'users', currentUser().uid, 'transactions', id);
}

function usageDocRef() {
  return doc(db, 'users', currentUser().uid, 'meta', 'usageCounts');
}

export async function initUsageCounts() {
  const snap = await getDoc(usageDocRef());
  if (!snap.exists()) await setDoc(usageDocRef(), { categories: {}, assets: {} });
}

export async function getUsageCounts() {
  const snap = await getDoc(usageDocRef());
  return snap.exists() ? snap.data() : { categories: {}, assets: {} };
}

function usageNested(categoryName, assetId, delta) {
  const nested = {};
  if (categoryName) nested.categories = { [categoryName]: increment(delta) };
  if (assetId) nested.assets = { [assetId]: increment(delta) };
  return nested;
}

function mergeUsageNested(a, b) {
  const r = {};
  if (a.categories || b.categories) r.categories = { ...a.categories, ...b.categories };
  if (a.assets || b.assets) r.assets = { ...a.assets, ...b.assets };
  return r;
}

function applyUsage(batch, nested) {
  if (Object.keys(nested).length) batch.set(usageDocRef(), nested, { merge: true });
}

// ─── 카테고리 ──────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  { name: '식비',     type: 'expense', sortOrder: 1 },
  { name: '교통',     type: 'expense', sortOrder: 2 },
  { name: '쇼핑',     type: 'expense', sortOrder: 3 },
  { name: '의료',     type: 'expense', sortOrder: 4 },
  { name: '문화/여가', type: 'expense', sortOrder: 5 },
  { name: '통신',     type: 'expense', sortOrder: 6 },
  { name: '주거',     type: 'expense', sortOrder: 7 },
  { name: '교육',     type: 'expense', sortOrder: 8 },
  { name: '기타',     type: 'expense', sortOrder: 9 },
  { name: '급여',     type: 'income',  sortOrder: 10 },
  { name: '부업',     type: 'income',  sortOrder: 11 },
  { name: '이자/배당', type: 'income', sortOrder: 12 },
  { name: '적립금',   type: 'income',  sortOrder: 13, isSystem: true },
  { name: '기타',     type: 'income',  sortOrder: 14 },
];

export async function getCategories() {
  const snap = await getDocs(userCol('categories'));
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function addCategory(data) {
  return addDoc(userCol('categories'), { ...data, sortOrder: Date.now(), createdAt: Timestamp.now() });
}

export async function updateCategory(id, data) {
  return updateDoc(doc(db, 'users', currentUser().uid, 'categories', id), data);
}

export async function deleteCategory(id) {
  return deleteDoc(doc(db, 'users', currentUser().uid, 'categories', id));
}

export async function initDefaultCategories() {
  const existing = await getCategories();
  if (existing.length > 0) return;
  const batch = writeBatch(db);
  for (const cat of DEFAULT_CATEGORIES) {
    batch.set(doc(userCol('categories')), { ...cat, createdAt: Timestamp.now() });
  }
  await batch.commit();
}

// ─── 자산 ──────────────────────────────────────────────────

export async function getAssets() {
  const snap = await getDocs(userCol('assets'));
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return list.sort((a, b) => {
    const aOrder = a.sortOrder ?? a.createdAt?.seconds ?? 0;
    const bOrder = b.sortOrder ?? b.createdAt?.seconds ?? 0;
    return aOrder - bOrder;
  });
}

export async function addAsset(data, sortOrder) {
  return addDoc(userCol('assets'), {
    ...data,
    balance: Number(data.balance),
    sortOrder: sortOrder ?? Date.now(),
    createdAt: Timestamp.now(),
  });
}

export async function swapAssetOrder(assetA, assetB) {
  const batch = writeBatch(db);
  const orderA = assetA.sortOrder ?? assetA.createdAt?.seconds ?? 0;
  const orderB = assetB.sortOrder ?? assetB.createdAt?.seconds ?? 0;
  batch.update(assetDocRef(assetA.id), { sortOrder: orderB });
  batch.update(assetDocRef(assetB.id), { sortOrder: orderA });
  await batch.commit();
}

export async function updateAsset(id, data) {
  const payload = { ...data };
  if ('balance' in payload) payload.balance = Number(payload.balance);
  return updateDoc(assetDocRef(id), payload);
}

export async function deleteAsset(id) {
  return deleteDoc(assetDocRef(id));
}

// ─── 거래 내역 ────────────────────────────────────────────

// sourceAsset: 선택된 자산 객체 (prepaid 자동 적립 처리용)
export async function addTransaction(data, sourceAsset) {
  const batch = writeBatch(db);
  const txRef = doc(userCol('transactions'));

  // 충전카드 지출 시 적립금 자동 생성
  let rewardTxId = null;
  if (
    sourceAsset?.type === 'prepaid' &&
    data.type === 'expense' &&
    sourceAsset.rewardAssetId &&
    sourceAsset.rewardRate > 0
  ) {
    const rewardAmount = Math.floor(Number(data.amount) * sourceAsset.rewardRate / 100);
    if (rewardAmount > 0) {
      const rewardRef = doc(userCol('transactions'));
      rewardTxId = rewardRef.id;
      batch.set(rewardRef, {
        type: 'income',
        amount: rewardAmount,
        category: '적립금',
        date: Timestamp.fromDate(new Date(data.date)),
        memo: `자동 적립 (${sourceAsset.rewardRate}%)`,
        assetId: sourceAsset.rewardAssetId,
        assetName: null,
        isAutoReward: true,
        parentTxId: txRef.id,
        createdAt: Timestamp.now(),
      });
      batch.update(assetDocRef(sourceAsset.rewardAssetId), { balance: increment(rewardAmount) });
    }
  }

  batch.set(txRef, {
    ...data,
    amount: Number(data.amount),
    installment: data.installment || 1,
    date: Timestamp.fromDate(new Date(data.date)),
    createdAt: Timestamp.now(),
    ...(rewardTxId ? { rewardTxId } : {}),
  });

  if (data.assetId) {
    const delta = data.type === 'income' ? Number(data.amount) : -Number(data.amount);
    batch.update(assetDocRef(data.assetId), { balance: increment(delta) });
  }

  applyUsage(batch, usageNested(data.category, data.assetId, 1));

  await batch.commit();
}

export async function deleteTransaction(tx) {
  const batch = writeBatch(db);
  batch.delete(txDocRef(tx.id));

  if (tx.assetId) {
    const delta = tx.type === 'income' ? -tx.amount : tx.amount;
    batch.update(assetDocRef(tx.assetId), { balance: increment(delta) });
  }

  applyUsage(batch, usageNested(tx.category, tx.assetId, -1));

  // 연동된 적립금 내역도 삭제
  if (tx.rewardTxId) {
    const rewardSnap = await getDoc(txDocRef(tx.rewardTxId));
    if (rewardSnap.exists()) {
      const r = rewardSnap.data();
      batch.delete(txDocRef(tx.rewardTxId));
      if (r.assetId) {
        batch.update(assetDocRef(r.assetId), { balance: increment(-r.amount) });
      }
    }
  }

  await batch.commit();
}

export async function updateTransaction(id, oldTx, newData, sourceAsset) {
  const batch = writeBatch(db);

  // 기존 자산 효과 되돌리기
  if (oldTx.assetId) {
    const oldDelta = oldTx.type === 'income' ? -oldTx.amount : oldTx.amount;
    batch.update(assetDocRef(oldTx.assetId), { balance: increment(oldDelta) });
  }

  // 기존 적립금 내역 삭제
  if (oldTx.rewardTxId) {
    const rewardSnap = await getDoc(txDocRef(oldTx.rewardTxId));
    if (rewardSnap.exists()) {
      const r = rewardSnap.data();
      batch.delete(txDocRef(oldTx.rewardTxId));
      if (r.assetId) {
        batch.update(assetDocRef(r.assetId), { balance: increment(-r.amount) });
      }
    }
  }

  // 새 적립금 내역 생성
  let rewardTxId = null;
  if (
    sourceAsset?.type === 'prepaid' &&
    newData.type === 'expense' &&
    sourceAsset.rewardAssetId &&
    sourceAsset.rewardRate > 0
  ) {
    const rewardAmount = Math.floor(Number(newData.amount) * sourceAsset.rewardRate / 100);
    if (rewardAmount > 0) {
      const rewardRef = doc(userCol('transactions'));
      rewardTxId = rewardRef.id;
      batch.set(rewardRef, {
        type: 'income',
        amount: rewardAmount,
        category: '적립금',
        date: Timestamp.fromDate(new Date(newData.date)),
        memo: `자동 적립 (${sourceAsset.rewardRate}%)`,
        assetId: sourceAsset.rewardAssetId,
        assetName: null,
        isAutoReward: true,
        parentTxId: id,
        createdAt: Timestamp.now(),
      });
      batch.update(assetDocRef(sourceAsset.rewardAssetId), { balance: increment(rewardAmount) });
    }
  }

  // 새 자산 효과 적용
  if (newData.assetId) {
    const newDelta = newData.type === 'income' ? Number(newData.amount) : -Number(newData.amount);
    batch.update(assetDocRef(newData.assetId), { balance: increment(newDelta) });
  }

  // 카테고리/자산이 바뀐 경우 카운트 조정
  const uDec = usageNested(
    oldTx.category !== newData.category ? oldTx.category : null,
    oldTx.assetId !== newData.assetId ? oldTx.assetId : null,
    -1
  );
  const uInc = usageNested(
    oldTx.category !== newData.category ? newData.category : null,
    oldTx.assetId !== newData.assetId ? newData.assetId : null,
    1
  );
  applyUsage(batch, mergeUsageNested(uDec, uInc));

  batch.update(txDocRef(id), {
    ...newData,
    amount: Number(newData.amount),
    installment: newData.installment || 1,
    date: Timestamp.fromDate(new Date(newData.date)),
    rewardTxId: rewardTxId,
  });

  await batch.commit();
}

// ─── 이체 ────────────────────────────────────────────────

export async function addTransfer(data) {
  const batch = writeBatch(db);
  const txRef = doc(userCol('transactions'));
  batch.set(txRef, {
    type: 'transfer',
    amount: Number(data.amount),
    date: Timestamp.fromDate(new Date(data.date)),
    fromAssetId: data.fromAssetId || null,
    fromAssetName: data.fromAssetName || '',
    toAssetId: data.toAssetId || null,
    toAssetName: data.toAssetName || '',
    memo: data.memo || '',
    createdAt: Timestamp.now(),
  });
  if (data.fromAssetId) {
    batch.update(assetDocRef(data.fromAssetId), { balance: increment(-Number(data.amount)) });
  }
  if (data.toAssetId) {
    batch.update(assetDocRef(data.toAssetId), { balance: increment(Number(data.amount)) });
  }
  const aAdd = {};
  if (data.fromAssetId) aAdd[data.fromAssetId] = increment(1);
  if (data.toAssetId) aAdd[data.toAssetId] = increment(1);
  if (Object.keys(aAdd).length) batch.set(usageDocRef(), { assets: aAdd }, { merge: true });
  await batch.commit();
}

export async function deleteTransfer(tx) {
  const batch = writeBatch(db);
  batch.delete(txDocRef(tx.id));
  if (tx.fromAssetId) {
    batch.update(assetDocRef(tx.fromAssetId), { balance: increment(tx.amount) });
  }
  if (tx.toAssetId) {
    batch.update(assetDocRef(tx.toAssetId), { balance: increment(-tx.amount) });
  }
  const aDel = {};
  if (tx.fromAssetId) aDel[tx.fromAssetId] = increment(-1);
  if (tx.toAssetId) aDel[tx.toAssetId] = increment(-1);
  if (Object.keys(aDel).length) batch.set(usageDocRef(), { assets: aDel }, { merge: true });
  await batch.commit();
}

export async function updateTransfer(id, oldTx, newData) {
  const batch = writeBatch(db);
  // 기존 효과 되돌리기
  if (oldTx.fromAssetId) batch.update(assetDocRef(oldTx.fromAssetId), { balance: increment(oldTx.amount) });
  if (oldTx.toAssetId) batch.update(assetDocRef(oldTx.toAssetId), { balance: increment(-oldTx.amount) });
  // 새 효과 적용
  if (newData.fromAssetId) batch.update(assetDocRef(newData.fromAssetId), { balance: increment(-Number(newData.amount)) });
  if (newData.toAssetId) batch.update(assetDocRef(newData.toAssetId), { balance: increment(Number(newData.amount)) });
  // 자산 카운트 조정
  const aUp = {};
  if (oldTx.fromAssetId !== newData.fromAssetId) {
    if (oldTx.fromAssetId) aUp[oldTx.fromAssetId] = increment(-1);
    if (newData.fromAssetId) aUp[newData.fromAssetId] = increment(1);
  }
  if (oldTx.toAssetId !== newData.toAssetId) {
    if (oldTx.toAssetId) aUp[oldTx.toAssetId] = increment(-1);
    if (newData.toAssetId) aUp[newData.toAssetId] = increment(1);
  }
  if (Object.keys(aUp).length) batch.set(usageDocRef(), { assets: aUp }, { merge: true });
  batch.update(txDocRef(id), {
    amount: Number(newData.amount),
    date: Timestamp.fromDate(new Date(newData.date)),
    fromAssetId: newData.fromAssetId || null,
    fromAssetName: newData.fromAssetName || '',
    toAssetId: newData.toAssetId || null,
    toAssetName: newData.toAssetName || '',
    memo: newData.memo || '',
  });
  await batch.commit();
}

function sortByDateThenCreated(txs) {
  return txs.sort((a, b) => {
    const dd = (b.date?.seconds || 0) - (a.date?.seconds || 0);
    return dd !== 0 ? dd : (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
  });
}

export async function getFixedNames() {
  const q = query(userCol('transactions'), where('isFixed', '==', true));
  const snap = await getDocs(q);
  const names = new Set();
  snap.docs.forEach(d => {
    const data = d.data();
    const name = data.fixedName?.trim() || data.memo?.trim() || data.category;
    if (name) names.add(name);
  });
  return [...names].sort();
}

export async function getMonthTransactions(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const q = query(
    userCol('transactions'),
    where('date', '>=', Timestamp.fromDate(start)),
    where('date', '<', Timestamp.fromDate(end)),
    orderBy('date', 'desc')
  );
  const snap = await getDocs(q);
  return sortByDateThenCreated(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

export async function getMonthSummary(year, month) {
  // 할부 처리를 위해 최대 12개월 앞쪽까지 조회
  const winStart = new Date(year, month - 13, 1);
  const winEnd   = new Date(year, month, 1);

  const q = query(
    userCol('transactions'),
    where('date', '>=', Timestamp.fromDate(winStart)),
    where('date', '<',  Timestamp.fromDate(winEnd)),
    orderBy('date', 'desc')
  );
  const snap = await getDocs(q);
  const allTxs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  let income = 0, expense = 0;
  const catExpenses = {};
  const assetExpenses = {};

  for (const tx of allTxs) {
    const d = tx.date.toDate();
    const ty = d.getFullYear(), tm = d.getMonth() + 1;

    if (tx.type === 'income') {
      if (ty === year && tm === month) income += tx.amount;
    } else if (tx.type === 'expense') {
      const inst = tx.installment || 1;
      // 구매일 기준으로 집계 (결제기간 이동 없음)
      const monthsFromPurchase = (year - ty) * 12 + (month - tm);
      const inRange = inst <= 1
        ? monthsFromPurchase === 0
        : (monthsFromPurchase >= 0 && monthsFromPurchase < inst);
      if (inRange) {
        const monthly = inst > 1 ? Math.floor(tx.amount / inst) : tx.amount;
        expense += monthly;
        if (tx.category) catExpenses[tx.category] = (catExpenses[tx.category] || 0) + monthly;
        if (tx.assetId) {
          if (!assetExpenses[tx.assetId]) assetExpenses[tx.assetId] = { assetName: tx.assetName || '', amount: 0 };
          assetExpenses[tx.assetId].amount += monthly;
        }
      }
    }
  }

  const txs = sortByDateThenCreated(allTxs.filter(tx => {
    const d = tx.date.toDate();
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  }));

  return { income, expense, balance: income - expense, txs, catExpenses, assetExpenses };
}

// 특정 월에 결제되는 신용카드 청구 합계 (결제기간 + 할부 반영)
export async function getCardPayments(year, month) {
  const winStart = new Date(year, month - 13, 1);
  const winEnd   = new Date(year, month, 1);

  const q = query(
    userCol('transactions'),
    where('date', '>=', Timestamp.fromDate(winStart)),
    where('date', '<',  Timestamp.fromDate(winEnd)),
    orderBy('date', 'desc')
  );
  const snap = await getDocs(q);
  const allTxs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  function firstPayMonth(tx) {
    const d = tx.date.toDate();
    const ty = d.getFullYear(), tm = d.getMonth() + 1, td = d.getDate();
    const bs = tx.billingCycleStart || 1;
    if (bs <= 1) return { year: ty, month: tm };
    if (td >= bs) return tm === 12 ? { year: ty + 1, month: 1 } : { year: ty, month: tm + 1 };
    return { year: ty, month: tm };
  }

  const cardTotals = {};
  for (const tx of allTxs) {
    if (tx.type !== 'expense') continue;
    if ((tx.billingCycleStart || 1) <= 1) continue; // 결제기간 없는 카드는 제외

    const fpm = firstPayMonth(tx);
    const inst = tx.installment || 1;
    const monthsFromFirst = (year - fpm.year) * 12 + (month - fpm.month);
    const inRange = inst <= 1
      ? monthsFromFirst === 0
      : (monthsFromFirst >= 0 && monthsFromFirst < inst);

    if (inRange && tx.assetId) {
      const monthly = inst > 1 ? Math.floor(tx.amount / inst) : tx.amount;
      if (!cardTotals[tx.assetId]) {
        cardTotals[tx.assetId] = { assetName: tx.assetName || '카드', amount: 0 };
      }
      cardTotals[tx.assetId].amount += monthly;
    }
  }

  return Object.entries(cardTotals)
    .map(([assetId, v]) => ({ assetId, ...v }))
    .filter(c => c.amount > 0);
}
