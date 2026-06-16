// ── Registra Service Worker ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Banner de instalação ──────────────────────────────────────────────────────
(function () {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (isInStandalone) return;

  const style = document.createElement('style');
  style.textContent = `
    #pwa-banner {
      position: fixed;
      bottom: 90px;
      left: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      color: #f9fafb;
      transition: transform .3s ease;
      transform: translateX(calc(-100% + 36px));
    }
    #pwa-banner:hover, #pwa-banner.expanded {
      transform: translateX(0);
    }
    #pwa-banner-tab {
      width: 36px;
      background: #d4111c;
      border-radius: 0 8px 8px 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px 6px;
      flex-shrink: 0;
      cursor: pointer;
    }
    #pwa-banner-tab svg { display: block; }
    #pwa-banner-body {
      background: #111827;
      border-top: 2px solid #d4111c;
      border-right: 2px solid #d4111c;
      border-bottom: 2px solid #d4111c;
      border-radius: 0 8px 8px 0;
      padding: 10px 12px 10px 10px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #pwa-banner img { width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0 }
    #pwa-banner-text { line-height: 1.4; white-space: nowrap; }
    #pwa-banner-text strong { display: block; font-size: 13px }
    #pwa-banner-text span { color: #9ca3af; font-size: 11px }
    #pwa-install-btn {
      background: #d4111c; color: #fff; border: none; border-radius: 6px;
      padding: 7px 12px; font-family: 'Bebas Neue', sans-serif; font-size: 15px;
      letter-spacing: 1px; cursor: pointer; flex-shrink: 0; white-space: nowrap;
    }
    #pwa-close-btn {
      background: none; border: none; color: #6b7280; font-size: 18px;
      cursor: pointer; padding: 2px 0 2px 4px; flex-shrink: 0; line-height: 1;
    }
    #pwa-ios-hint { font-size: 12px; color: #9ca3af; line-height: 1.5; white-space: nowrap; }
  `;
  document.head.appendChild(style);

  function makeBanner(innerHtml) {
    const banner = document.createElement('div');
    banner.id = 'pwa-banner';
    banner.innerHTML = `
      <div id="pwa-banner-tab">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24">
          <path fill="#fff" d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 13h-2v-5h2v5zm0-7h-2V6h2v2z"/>
        </svg>
      </div>
      <div id="pwa-banner-body">${innerHtml}</div>
    `;
    document.body.appendChild(banner);
    document.getElementById('pwa-banner-tab').onclick = () => banner.classList.toggle('expanded');
    return banner;
  }

  // ── iOS ───────────────────────────────────────────────────────────────────
  if (isIOS) {
    if (sessionStorage.getItem('pwa-dismissed')) return;
    setTimeout(() => {
      const banner = makeBanner(`
        <img src="/icon-192.png" alt="Punch and Roll">
        <span id="pwa-ios-hint">
          <strong style="color:#f9fafb">Instale o app!</strong>
          Toque em <strong>⎙ Compartilhar</strong><br>
          depois <strong>"Adicionar à Tela de Início"</strong>
        </span>
        <button id="pwa-close-btn" aria-label="Fechar">✕</button>
      `);
      document.getElementById('pwa-close-btn').onclick = () => {
        banner.remove();
        sessionStorage.setItem('pwa-dismissed', '1');
      };
    }, 3000);
    return;
  }

  // ── Android ───────────────────────────────────────────────────────────────
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (localStorage.getItem('pwa-installed')) return;

    const banner = makeBanner(`
      <img src="/icon-192.png" alt="Punch and Roll">
      <div id="pwa-banner-text">
        <strong>Punch and Roll</strong>
        <span>Instale o app — funciona offline!</span>
      </div>
      <button id="pwa-install-btn">INSTALAR</button>
      <button id="pwa-close-btn" aria-label="Fechar">✕</button>
    `);

    document.getElementById('pwa-install-btn').onclick = async () => {
      banner.remove();
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') localStorage.setItem('pwa-installed', '1');
      deferredPrompt = null;
    };
    document.getElementById('pwa-close-btn').onclick = () => banner.remove();
  });

  window.addEventListener('appinstalled', () => {
    localStorage.setItem('pwa-installed', '1');
    const b = document.getElementById('pwa-banner');
    if (b) b.remove();
  });
})();
