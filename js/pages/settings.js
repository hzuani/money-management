import { currentUser, logout } from '../auth.js';
import { navigate } from '../router.js';

export function renderSettings(container) {
  const user = currentUser();
  container.innerHTML = `
    <div class="px-4 pt-6">
      <h1 class="text-xl font-bold text-gray-800 mb-5">설정</h1>

      <!-- 프로필 -->
      <div class="bg-white rounded-2xl p-4 shadow-sm mb-4 flex items-center gap-4">
        <img src="${user.photoURL || ''}" alt="프로필"
          class="w-14 h-14 rounded-full bg-gray-100 object-cover" />
        <div>
          <p class="font-semibold text-gray-800">${user.displayName || '사용자'}</p>
          <p class="text-sm text-gray-400">${user.email || ''}</p>
        </div>
      </div>

      <!-- 메뉴 -->
      <div class="bg-white rounded-2xl shadow-sm divide-y divide-gray-50 mb-4">
        <button id="go-categories" class="w-full flex items-center justify-between px-4 py-3.5 active:bg-gray-50">
          <span class="text-sm text-gray-800">카테고리 관리</span>
          <span class="text-gray-300">›</span>
        </button>
      </div>

      <!-- 앱 정보 -->
      <div class="bg-white rounded-2xl shadow-sm divide-y divide-gray-50 mb-6">
        <div class="px-4 py-3.5 flex items-center justify-between">
          <span class="text-sm text-gray-700">앱 버전</span>
          <span class="text-sm text-gray-400">1.0.0</span>
        </div>
      </div>

      <button id="logout-btn"
        class="w-full border border-red-200 text-red-500 font-medium py-3 rounded-xl active:bg-red-50">
        로그아웃
      </button>
    </div>
  `;

  container.querySelector('#go-categories').addEventListener('click', () => navigate('categories'));
  container.querySelector('#logout-btn').addEventListener('click', async () => {
    if (confirm('로그아웃 하시겠어요?')) await logout();
  });
}
