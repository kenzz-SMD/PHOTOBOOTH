// ===================== SOCIAL SHARE BUTTONS =====================
// ShareUI.render(container, url, text) fills a container with sleek round icon buttons
// (WhatsApp, Telegram, Facebook, X, Email, Copy link, and the phone's own share sheet).
const ShareUI = (() => {
  const svg = (p) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' + p + '</svg>';
  const NETS = [
    { id: 'whatsapp', label: 'WhatsApp', color: '#25d366',
      href: (u, t) => 'https://wa.me/?text=' + encodeURIComponent(t + ' ' + u),
      icon: svg('<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm0 1.8a7.2 7.2 0 1 1-3.7 13.4l-.3-.2-2.7.7.7-2.6-.2-.3A7.2 7.2 0 0 1 12 4.8zM9.4 8.4c-.2 0-.5.1-.7.4-.3.3-1 1-1 2.4s1 2.7 1.2 2.9c.1.2 2 3.1 4.9 4.2 2.4.9 2.9.7 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4l-.5-.3-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.9-.4-2-1-2.9-2.4-.2-.4 0-.5.2-.6l.5-.6.3-.5c.1-.2 0-.4 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4z"/>') },
    { id: 'telegram', label: 'Telegram', color: '#2aa3e0',
      href: (u, t) => 'https://t.me/share/url?url=' + encodeURIComponent(u) + '&text=' + encodeURIComponent(t),
      icon: svg('<path d="M21.6 3.4 2.7 10.7c-1 .4-1 1.1-.2 1.3l4.8 1.5 1.9 5.7c.2.6.4.7.9.7.4 0 .6-.2.9-.4l2.2-2.1 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.5-1.5zM9.2 13.4l9.3-5.9c.4-.3.8-.1.5.2l-7.7 6.9-.3 3.3z"/>') },
    { id: 'facebook', label: 'Facebook', color: '#1877f2',
      href: (u) => 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(u),
      icon: svg('<path d="M14 8V6.5c0-.7.2-1 1.1-1H17V2h-2.8C11.2 2 10 3.7 10 6.2V8H8v3.5h2V22h4V11.5h2.7L17 8z"/>') },
    { id: 'x', label: 'X', color: '#111',
      href: (u, t) => 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(u) + '&text=' + encodeURIComponent(t),
      icon: svg('<path d="M18.2 2.5h3.1l-6.8 7.8 8 11.2h-6.3l-4.9-6.8-5.6 6.8H2.6l7.3-8.4L2.2 2.5h6.4l4.4 6.2zm-1.1 17.1h1.7L7.5 4.3H5.7z"/>') },
    { id: 'email', label: 'Email', color: '#ff7a59',
      href: (u, t) => 'mailto:?subject=' + encodeURIComponent(t) + '&body=' + encodeURIComponent(t + '\n' + u),
      icon: svg('<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.5 2v.3l7.5 5.2 7.5-5.2V7zm15 2.7-7.1 4.9a.7.7 0 0 1-.8 0L4.5 9.7V17h15z"/>') }
  ];
  const LINK = svg('<path d="M10.6 13.4a1 1 0 0 0 1.4 1.4l4-4a3 3 0 1 0-4.2-4.2l-1.5 1.5 1.4 1.4 1.5-1.5a1 1 0 1 1 1.4 1.4zM13.4 10.6a1 1 0 0 0-1.4-1.4l-4 4a3 3 0 1 0 4.2 4.2l1.5-1.5-1.4-1.4-1.5 1.5a1 1 0 1 1-1.4-1.4z"/>');
  const NATIVE = svg('<path d="M18 16a3 3 0 0 0-2.1.9l-6.9-4a3 3 0 0 0 0-1.8l6.8-4A3 3 0 1 0 15 5a3 3 0 0 0 .1.9l-6.8 4a3 3 0 1 0 0 4.2l6.9 4A3 3 0 1 0 18 16z"/>');
  const tr = (k, d) => (typeof I18N !== 'undefined' ? I18N.t(k) : d);

  function make(tag, cls, color, label, html) {
    const el = document.createElement(tag);
    el.className = 'soc ' + cls;
    el.style.setProperty('--c', color);
    el.title = label; el.setAttribute('aria-label', label);
    el.innerHTML = html;
    return el;
  }

  function render(box, url, text) {
    box.innerHTML = '';
    NETS.forEach((n, i) => {
      const a = make('a', n.id, n.color, n.label, n.icon);
      a.href = n.href(url, text); a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.style.setProperty('--i', i);
      box.appendChild(a);
    });
    const copy = make('button', 'copy', '#8b5cf6', tr('qr.copy', 'Copy link'), LINK);
    copy.type = 'button'; copy.style.setProperty('--i', NETS.length);
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); }
      catch (e) { const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e2) {} t.remove(); }
      copy.dataset.tip = tr('qr.copied', 'Link copied!');
      copy.classList.add('copied');
      setTimeout(() => { copy.classList.remove('copied'); delete copy.dataset.tip; }, 1600);
    });
    box.appendChild(copy);
    if (navigator.share) {
      const nat = make('button', 'native', '#ff6b81', 'Share', NATIVE);
      nat.type = 'button'; nat.style.setProperty('--i', NETS.length + 1);
      nat.addEventListener('click', () => { navigator.share({ title: text, text, url }).catch(() => {}); });
      box.appendChild(nat);
    }
  }
  return { render };
})();