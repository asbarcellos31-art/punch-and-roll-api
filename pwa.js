// ── Registra Service Worker ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Botão flutuante de instalação ─────────────────────────────────────────────
(function () {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (isInStandalone) return;

  const style = document.createElement('style');
  style.textContent = `
    #pwa-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: #d4111c;
      box-shadow: 0 4px 16px rgba(212,17,28,.5);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .2s ease, box-shadow .2s ease;
      padding: 0;
    }
    #pwa-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 24px rgba(212,17,28,.65);
    }
    #pwa-fab img {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      pointer-events: none;
    }
    #pwa-fab-badge {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 18px;
      height: 18px;
      background: #fff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #pwa-fab-badge svg { display: block; }

    #pwa-tooltip {
      position: fixed;
      bottom: 92px;
      right: 16px;
      z-index: 99999;
      background: #111827;
      border: 1px solid #d4111c;
      border-radius: 12px;
      padding: 14px 16px;
      max-width: 230px;
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      color: #f9fafb;
      line-height: 1.5;
      box-shadow: 0 8px 32px rgba(0,0,0,.4);
      animation: pwa-pop .2s ease;
    }
    #pwa-tooltip::after {
      content: '';
      position: absolute;
      bottom: -7px;
      right: 24px;
      width: 12px;
      height: 12px;
      background: #111827;
      border-right: 1px solid #d4111c;
      border-bottom: 1px solid #d4111c;
      transform: rotate(45deg);
    }
    #pwa-tooltip-close {
      position: absolute;
      top: 8px;
      right: 10px;
      background: none;
      border: none;
      color: #6b7280;
      font-size: 16px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
    }
    #pwa-tooltip strong { display: block; color: #f9fafb; margin-bottom: 4px; }
    #pwa-tooltip span { color: #9ca3af; }
    @keyframes pwa-pop {
      from { opacity: 0; transform: translateY(6px) scale(.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(style);

  function createFab() {
    const btn = document.createElement('button');
    btn.id = 'pwa-fab';
    btn.setAttribute('aria-label', 'Instalar aplicativo');
    btn.innerHTML = `
      <img src="/icon-192.png" alt="Punch and Roll">
      <span id="pwa-fab-badge">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="#d4111c">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 11v-2h2v2h-2zm-4 0v-2h2v2H7zm8 0v-2h2v2h-2z"/>
        </svg>
      </span>
    `;
    document.body.appendChild(btn);
    return btn;
  }

  // ── iOS ───────────────────────────────────────────────────────────────────
  if (isIOS) {
    if (sessionStorage.getItem('pwa-dismissed')) return;

    const fab = createFab();
    let tooltip = null;

    fab.onclick = () => {
      if (tooltip) { tooltip.remove(); tooltip = null; return; }

      tooltip = document.createElement('div');
      tooltip.id = 'pwa-tooltip';
      tooltip.innerHTML = `
        <button id="pwa-tooltip-close" aria-label="Fechar">✕</button>
        <strong>Instale o app!</strong>
        <span>Toque em <strong style="color:#f9fafb">⎙ Compartilhar</strong><br>
        depois em <strong style="color:#f9fafb">"Adicionar à Tela de Início"</strong></span>
      `;
      document.body.appendChild(tooltip);

      document.getElementById('pwa-tooltip-close').onclick = (e) => {
        e.stopPropagation();
        tooltip.remove();
        tooltip = null;
        fab.remove();
        sessionStorage.setItem('pwa-dismissed', '1');
      };
    };
    return;
  }

  // ── Android / Desktop ─────────────────────────────────────────────────────
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (localStorage.getItem('pwa-installed')) return;

    const fab = createFab();

    fab.onclick = async () => {
      if (!deferredPrompt) return;
      fab.remove();
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') localStorage.setItem('pwa-installed', '1');
      deferredPrompt = null;
    };
  });

  window.addEventListener('appinstalled', () => {
    localStorage.setItem('pwa-installed', '1');
    const fab = document.getElementById('pwa-fab');
    if (fab) fab.remove();
  });
})();
