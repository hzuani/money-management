import { onAuthChange, loginWithGoogle, logout } from './auth.js';
import { initRouter, register, navigate } from './router.js';
import { initDefaultCategories, initUsageCounts } from './db.js';
import { renderTransactions } from './pages/transactions.js';
import { renderAssets } from './pages/assets.js';
import { renderStats } from './pages/stats.js';
import { renderSettings } from './pages/settings.js';
import { renderCategories } from './pages/categories.js';
import { renderFixed } from './pages/fixed.js';

register('transactions', renderTransactions);
register('assets', renderAssets);
register('fixed', renderFixed);
register('stats', renderStats);
register('settings', renderSettings);
register('categories', renderCategories);

const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const bottomNav = document.getElementById('bottom-nav');

onAuthChange(async user => {
  if (user) {
    loginScreen.classList.add('hidden');
    app.classList.remove('hidden');
    bottomNav.classList.remove('hidden');
    await initDefaultCategories();
    await initUsageCounts();
    initRouter();
  } else {
    loginScreen.classList.remove('hidden');
    app.classList.add('hidden');
    bottomNav.classList.add('hidden');
  }
});

document.getElementById('google-login-btn').addEventListener('click', () => {
  loginWithGoogle().catch(err => alert('로그인 실패: ' + err.message));
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.page));
});
