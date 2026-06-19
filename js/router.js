const routes = {};
let currentPage = null;

export function register(name, renderFn) {
  routes[name] = renderFn;
}

export function navigate(page) {
  location.hash = page;
}

export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

function handleRoute() {
  const page = location.hash.replace('#', '') || 'transactions';
  if (currentPage === page) return;
  currentPage = page;

  const render = routes[page] || routes['transactions'];
  const container = document.getElementById('page-container');
  container.innerHTML = '';
  render(container);

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
}
