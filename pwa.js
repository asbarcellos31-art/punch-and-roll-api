// ── Registra Service Worker ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Banner de instalação ──────────────────────────────────────────────────────
(function () {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (isInStandalone) return; // já está instalado

  // ── CSS do banner ─────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #pwa-banner {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
      background: #111827; border-top: 2px solid #d4111c;
      padding: 12px 16px; display: flex; align-items: center; gap: 12px;
      font-family: 'DM Sans', sans-serif; font-size: 13px; color: #f9fafb;
      animation: slideUp .3s ease;
    }
    @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
    #pwa-banner img { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0 }
    #pwa-banner-text { flex: 1; line-height: 1.4 }
    #pwa-banner-text strong { display: block; font-size: 14px }
    #pwa-banner-text span { color: #9ca3af; font-size: 12px }
    #pwa-install-btn {
      background: #d4111c; color: #fff; border: none; border-radius: 8px;
      padding: 9px 16px; font-family: 'Bebas Neue', sans-serif; font-size: 16px;
      letter-spacing: 1px; cursor: pointer; flex-shrink: 0;
    }
    #pwa-close-btn {
      background: none; border: none; color: #6b7280; font-size: 20px;
      cursor: pointer; padding: 4px; flex-shrink: 0; line-height: 1;
    }
    #pwa-ios-hint {
      font-size: 12px; color: #9ca3af; flex: 1; line-height: 1.5
    }
  `;
  document.head.appendChild(style);

  // ── Mostra banner iOS ─────────────────────────────────────────────────────
  if (isIOS) {
    // Só mostra uma vez por sessão
    if (sessionStorage.getItem('pwa-dismissed')) return;
    setTimeout(() => {
      const banner = document.createElement('div');
      banner.id = 'pwa-banner';
      banner.innerHTML = `
        <img src="/icon-192.png" alt="Punch and Roll">
        <span id="pwa-ios-hint">
          <strong style="color:#f9fafb">Instale o app!</strong>
          Toque em <strong>⎙ Compartilhar</strong> e depois<br>
          <strong>"Adicionar à Tela de Início"</strong>
        </span>
        <button id="pwa-close-btn" aria-label="Fechar">✕</button>
      `;
      document.body.appendChild(banner);
      document.getElementById('pwa-close-btn').onclick = () => {
        banner.remove();
        sessionStorage.setItem('pwa-dismissed', '1');
      };
    }, 3000);
    return;
  }

  // ── Banner Android (beforeinstallprompt) ──────────────────────────────────
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    if (localStorage.getItem('pwa-installed')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-banner';
    banner.innerHTML = `
      <img src="/icon-192.png" alt="Punch and Roll">
      <div id="pwa-banner-text">
        <strong>Punch and Roll</strong>
        <span>Instale o app — funciona offline!</span>
      </div>
      <button id="pwa-install-btn">INSTALAR</button>
      <button id="pwa-close-btn" aria-label="Fechar">✕</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').onclick = async () => {
      banner.remove();
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') localStorage.setItem('pwa-installed', '1');
      deferredPrompt = null;
    };

    document.getElementById('pwa-close-btn').onclick = () => banner.remove();
  });

  // Marca como instalado se o usuário já instalou via outra via
  window.addEventListener('appinstalled', () => {
    localStorage.setItem('pwa-installed', '1');
    const b = document.getElementById('pwa-banner');
    if (b) b.remove();
  });
})();
