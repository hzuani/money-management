import { getCategories, addCategory, updateCategory, deleteCategory } from '../db.js';
import { navigate } from '../router.js';

let categories = [];
let catTab = 'expense';
let editingCat = null;
let modalType = 'expense';

export async function renderCategories(container) {
  container.innerHTML = buildShell();
  categories = await getCategories();
  renderCatList();
  bindEvents(container);
}

function buildShell() {
  return `
    <div class="px-4 pt-6 pb-4">
      <div class="flex items-center gap-3 mb-6">
        <button id="back-btn" class="text-gray-400 text-xl px-1">‹</button>
        <h1 class="text-xl font-bold text-gray-800">카테고리 관리</h1>
        <button id="add-cat-btn" class="ml-auto text-sm text-indigo-500 font-medium">+ 추가</button>
      </div>

      <!-- 지출/수입 탭 -->
      <div class="flex bg-gray-100 rounded-xl p-1 mb-4" id="cat-tabs">
        <button data-tab="expense" class="cat-tab flex-1 py-1.5 rounded-lg text-sm font-medium transition bg-white text-red-500 shadow">지출</button>
        <button data-tab="income"  class="cat-tab flex-1 py-1.5 rounded-lg text-sm font-medium transition text-gray-400">수입</button>
      </div>

      <div id="cat-list" class="bg-white rounded-2xl shadow-sm divide-y divide-gray-50 overflow-hidden"></div>
    </div>

    <!-- 추가/수정 모달 -->
    <div id="cat-modal" class="hidden fixed inset-0 z-50 flex items-end">
      <div class="absolute inset-0 bg-black/40" id="cat-modal-backdrop"></div>
      <div class="relative bg-white rounded-t-2xl w-full max-w-md mx-auto p-6 z-10">
        <h2 id="cat-modal-title" class="text-lg font-bold text-gray-800 mb-4">카테고리 추가</h2>

        <div class="mb-3">
          <label class="text-xs text-gray-500 mb-1 block">이름</label>
          <input id="cat-name" type="text" placeholder="카테고리 이름"
            class="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:border-indigo-400" />
        </div>

        <div class="flex bg-gray-100 rounded-xl p-1 mb-5" id="cat-type-tabs">
          <button data-type="expense" class="cat-type-tab flex-1 py-1.5 rounded-lg text-sm font-medium transition bg-white text-red-500 shadow">지출</button>
          <button data-type="income"  class="cat-type-tab flex-1 py-1.5 rounded-lg text-sm font-medium transition text-gray-400">수입</button>
        </div>

        <button id="cat-save-btn" class="w-full bg-indigo-500 text-white font-semibold py-3.5 rounded-xl active:bg-indigo-600">
          저장
        </button>
      </div>
    </div>
  `;
}

function renderCatList() {
  const el = document.getElementById('cat-list');
  const filtered = categories.filter(c => c.type === catTab);
  if (filtered.length === 0) {
    el.innerHTML = `<p class="text-center text-gray-400 py-8 text-sm">카테고리가 없습니다</p>`;
    return;
  }
  el.innerHTML = filtered.map(c => `
    <div class="flex items-center gap-3 px-4 py-3.5">
      <span class="flex-1 text-sm text-gray-800">${c.name}</span>
      ${c.isSystem
        ? `<span class="text-xs text-gray-300 mr-2">시스템</span>`
        : `<button class="edit-cat text-xs text-gray-400 px-1.5" data-id="${c.id}">수정</button>
           <button class="del-cat text-xs text-gray-400 px-1.5" data-id="${c.id}">삭제</button>`
      }
    </div>
  `).join('');
}

function switchCatTab(tab) {
  catTab = tab;
  document.querySelectorAll('.cat-tab').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('bg-white', isActive);
    btn.classList.toggle('shadow', isActive);
    btn.classList.toggle('text-gray-400', !isActive);
    btn.classList.remove('text-red-500', 'text-blue-500');
    if (isActive) btn.classList.add(tab === 'expense' ? 'text-red-500' : 'text-blue-500');
  });
  renderCatList();
}

function openModal(cat = null) {
  editingCat = cat;
  document.getElementById('cat-modal-title').textContent = cat ? '카테고리 수정' : '카테고리 추가';
  document.getElementById('cat-name').value = cat?.name || '';
  switchModalType(cat ? cat.type : catTab);
  document.getElementById('cat-modal').classList.remove('hidden');
  document.getElementById('cat-name').focus();
}

function closeModal() {
  document.getElementById('cat-modal').classList.add('hidden');
  editingCat = null;
}

function switchModalType(type) {
  modalType = type;
  document.querySelectorAll('.cat-type-tab').forEach(btn => {
    const isActive = btn.dataset.type === type;
    btn.classList.toggle('bg-white', isActive);
    btn.classList.toggle('shadow', isActive);
    btn.classList.toggle('text-gray-400', !isActive);
    btn.classList.remove('text-red-500', 'text-blue-500');
    if (isActive) btn.classList.add(type === 'expense' ? 'text-red-500' : 'text-blue-500');
  });
}

function bindEvents(container) {
  container.querySelector('#back-btn').addEventListener('click', () => navigate('settings'));
  container.querySelector('#add-cat-btn').addEventListener('click', () => openModal());

  container.querySelector('#cat-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.cat-tab');
    if (btn) switchCatTab(btn.dataset.tab);
  });

  document.getElementById('cat-modal-backdrop').addEventListener('click', closeModal);

  document.getElementById('cat-type-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.cat-type-tab');
    if (btn) switchModalType(btn.dataset.type);
  });

  document.getElementById('cat-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('cat-name').value.trim();
    if (!name) return alert('이름을 입력해주세요');

    const data = { name, type: modalType };
    if (editingCat) {
      await updateCategory(editingCat.id, data);
      const idx = categories.findIndex(c => c.id === editingCat.id);
      categories[idx] = { ...categories[idx], ...data };
    } else {
      const ref = await addCategory(data);
      categories.push({ id: ref.id, ...data, sortOrder: Date.now() });
    }
    closeModal();
    renderCatList();
  });

  document.getElementById('cat-list').addEventListener('click', async e => {
    const edit = e.target.closest('.edit-cat');
    const del = e.target.closest('.del-cat');
    if (edit) {
      const cat = categories.find(c => c.id === edit.dataset.id);
      if (cat) openModal(cat);
    }
    if (del) {
      if (!confirm('삭제할까요?')) return;
      await deleteCategory(del.dataset.id);
      categories = categories.filter(c => c.id !== del.dataset.id);
      renderCatList();
    }
  });
}
