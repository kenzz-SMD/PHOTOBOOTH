// ===================== LANGUAGES + ANIMATED FLAG SWITCH =====================
// Mark text with data-i18n="key" (or data-i18n-title / data-i18n-ph for tooltips / placeholders).
// Flags are inline SVG (flag emoji don't show on Windows). The choice is remembered per device.
const I18N = (() => {
  const LANGS = [
    { id: 'en',  name: 'English',  html: 'en' },
    { id: 'fil', name: 'Filipino', html: 'fil' },
    { id: 'es',  name: 'Español',  html: 'es' },
    { id: 'ja',  name: '日本語',    html: 'ja' }
  ];

  const FLAGS = {
    en: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><g fill="#d22b3a"><rect width="30" height="1.6"/><rect y="3.2" width="30" height="1.6"/><rect y="6.4" width="30" height="1.6"/><rect y="9.6" width="30" height="1.6"/><rect y="12.8" width="30" height="1.6"/><rect y="16" width="30" height="1.6"/></g><rect width="13" height="10.4" fill="#2b3f8f"/><g fill="#fff"><circle cx="2.5" cy="2.4" r=".7"/><circle cx="6.5" cy="2.4" r=".7"/><circle cx="10.5" cy="2.4" r=".7"/><circle cx="4.5" cy="5.2" r=".7"/><circle cx="8.5" cy="5.2" r=".7"/><circle cx="2.5" cy="8" r=".7"/><circle cx="6.5" cy="8" r=".7"/><circle cx="10.5" cy="8" r=".7"/></g></svg>',
    fil: '<svg viewBox="0 0 30 20"><rect width="30" height="10" fill="#1f4fa3"/><rect y="10" width="30" height="10" fill="#d52b3e"/><path d="M0 0 16 10 0 20z" fill="#fff"/><circle cx="4.6" cy="10" r="2" fill="#f7c600"/></svg>',
    es:  '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#c8202f"/><rect y="5" width="30" height="10" fill="#f6c500"/></svg>',
    ja:  '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5.6" fill="#d7263d"/></svg>'
  };

  const T = {
    en: {
      'load.1': 'Developing your photos…', 'load.2': 'Sprinkling some sparkle…', 'load.3': 'Almost ready…', 'load.templates': 'Loading templates…',
      'welcome.tag': 'Get ready to strike a pose.', 'welcome.start': 'Start',
      'tmpl.title': 'Choose your template', 'tmpl.continue': 'Continue',
      'booth.title': 'Timeless Strips', 'btn.capture': '🎞️ Capture Strip ({n} Photos)',
      'btn.change': '🖼️ Change Template', 'btn.gallery': '🗂️ Gallery',
      'edit.title': 'Edit your strip', 'edit.reset': '↩️ Reset', 'edit.autocrop': '🧠 Auto-crop faces',
      'edit.retake': '🔁 Retake', 'edit.finalize': '✅ Finalize Strip',
      'result.title': 'Your Strip', 'result.empty': 'No strip selected yet. Take one, or pick one from the gallery below.',
      'btn.print': '🖨️ Print', 'btn.save': '💾 Save', 'btn.share': '📤 Share', 'btn.phone': '📱 Phone',
      'print.paper': 'Paper', 'print.copies': 'Copies', 'print.auto': 'Print automatically after each strip',
      'btn.editagain': '✏️ Edit Again', 'btn.new': '📸 New Strip', 'btn.home': '🏠 Home',
      'gallery.title': '🖼️ Gallery of past strips',
      'qr.title': 'Get it on your phone', 'qr.sub': 'Point your phone camera at the code',
      'qr.making': 'Making your link…', 'qr.share': 'Or share the link', 'qr.copied': 'Link copied!', 'qr.copy': 'Copy link',
      'qr.note': 'Anyone with this link can see the strip.',
      'qr.nocloud': 'Cloud sync is not set up, so a download link can’t be made. Use Save or Share instead.',
      'qr.offline': 'You are offline. Connect to the internet to make a download link.',
      'qr.local': 'This page runs on your own computer, so a phone can’t open the link. Open the booth from its web address.',
      'qr.fail': 'Could not make the link. Please try again.',
      'get.title': 'Your photo strip is ready!', 'get.sub': 'Save it to your phone and share the fun.',
      'get.save': '💾 Save to phone', 'get.share': 'Share with friends', 'get.hint': 'If saving doesn’t start, press and hold the picture.',
      'get.err': 'Sorry, this strip could not be loaded.', 'get.again': 'Try again', 'get.loading': 'Loading your strip…'
    },
    fil: {
      'load.1': 'Dine-develop ang mga larawan…', 'load.2': 'Nagwiwisik ng kislap…', 'load.3': 'Malapit na…', 'load.templates': 'Nilo-load ang mga template…',
      'welcome.tag': 'Humanda na sa pag-pose.', 'welcome.start': 'Simulan',
      'tmpl.title': 'Pumili ng template', 'tmpl.continue': 'Magpatuloy',
      'booth.title': 'Timeless Strips', 'btn.capture': '🎞️ Kunan ang Strip ({n} Larawan)',
      'btn.change': '🖼️ Palitan ang Template', 'btn.gallery': '🗂️ Gallery',
      'edit.title': 'I-edit ang strip', 'edit.reset': '↩️ I-reset', 'edit.autocrop': '🧠 Auto-crop ng mukha',
      'edit.retake': '🔁 Ulitin', 'edit.finalize': '✅ Tapusin ang Strip',
      'result.title': 'Iyong Strip', 'result.empty': 'Wala pang napiling strip. Kumuha ng bago o pumili sa gallery sa ibaba.',
      'btn.print': '🖨️ I-print', 'btn.save': '💾 I-save', 'btn.share': '📤 I-share', 'btn.phone': '📱 Sa Phone',
      'print.paper': 'Papel', 'print.copies': 'Kopya', 'print.auto': 'Awtomatikong i-print pagkatapos ng bawat strip',
      'btn.editagain': '✏️ I-edit Muli', 'btn.new': '📸 Bagong Strip', 'btn.home': '🏠 Home',
      'gallery.title': '🖼️ Mga nakaraang strip',
      'qr.title': 'Kunin sa iyong phone', 'qr.sub': 'Itutok ang camera ng phone sa code',
      'qr.making': 'Ginagawa ang link…', 'qr.share': 'O i-share ang link', 'qr.copied': 'Nakopya ang link!', 'qr.copy': 'Kopyahin ang link',
      'qr.note': 'Makikita ng sinumang may link na ito ang strip.',
      'qr.nocloud': 'Hindi pa naka-set up ang cloud sync, kaya hindi makagawa ng link. Gamitin ang I-save o I-share.',
      'qr.offline': 'Offline ka. Kumonekta sa internet para makagawa ng link.',
      'qr.local': 'Tumatakbo ito sa sarili mong computer, kaya hindi mabubuksan ng phone ang link. Buksan ang booth gamit ang web address nito.',
      'qr.fail': 'Hindi nagawa ang link. Pakisubukan ulit.',
      'get.title': 'Handa na ang iyong photo strip!', 'get.sub': 'I-save sa phone at ibahagi ang saya.',
      'get.save': '💾 I-save sa phone', 'get.share': 'Ibahagi sa mga kaibigan', 'get.hint': 'Kung hindi nagsimula ang pag-save, pindutin nang matagal ang larawan.',
      'get.err': 'Paumanhin, hindi ma-load ang strip na ito.', 'get.again': 'Subukan ulit', 'get.loading': 'Nilo-load ang iyong strip…'
    },
    es: {
      'load.1': 'Revelando tus fotos…', 'load.2': 'Añadiendo un poco de brillo…', 'load.3': 'Casi listo…', 'load.templates': 'Cargando plantillas…',
      'welcome.tag': 'Prepárate para posar.', 'welcome.start': 'Empezar',
      'tmpl.title': 'Elige tu plantilla', 'tmpl.continue': 'Continuar',
      'booth.title': 'Timeless Strips', 'btn.capture': '🎞️ Capturar tira ({n} fotos)',
      'btn.change': '🖼️ Cambiar plantilla', 'btn.gallery': '🗂️ Galería',
      'edit.title': 'Edita tu tira', 'edit.reset': '↩️ Restablecer', 'edit.autocrop': '🧠 Recorte de rostros',
      'edit.retake': '🔁 Repetir', 'edit.finalize': '✅ Finalizar tira',
      'result.title': 'Tu tira', 'result.empty': 'Aún no hay tira seleccionada. Toma una o elige una de la galería.',
      'btn.print': '🖨️ Imprimir', 'btn.save': '💾 Guardar', 'btn.share': '📤 Compartir', 'btn.phone': '📱 Móvil',
      'print.paper': 'Papel', 'print.copies': 'Copias', 'print.auto': 'Imprimir automáticamente después de cada tira',
      'btn.editagain': '✏️ Editar de nuevo', 'btn.new': '📸 Nueva tira', 'btn.home': '🏠 Inicio',
      'gallery.title': '🖼️ Galería de tiras anteriores',
      'qr.title': 'Llévatela en tu móvil', 'qr.sub': 'Apunta la cámara de tu móvil al código',
      'qr.making': 'Creando tu enlace…', 'qr.share': 'O comparte el enlace', 'qr.copied': '¡Enlace copiado!', 'qr.copy': 'Copiar enlace',
      'qr.note': 'Cualquiera con este enlace puede ver la tira.',
      'qr.nocloud': 'La sincronización en la nube no está configurada, así que no se puede crear un enlace. Usa Guardar o Compartir.',
      'qr.offline': 'Estás sin conexión. Conéctate a internet para crear un enlace.',
      'qr.local': 'Esta página se ejecuta en tu propio equipo, así que un móvil no puede abrir el enlace. Abre la cabina desde su dirección web.',
      'qr.fail': 'No se pudo crear el enlace. Inténtalo de nuevo.',
      'get.title': '¡Tu tira de fotos está lista!', 'get.sub': 'Guárdala en tu móvil y comparte la diversión.',
      'get.save': '💾 Guardar en el móvil', 'get.share': 'Comparte con tus amigos', 'get.hint': 'Si no empieza a guardarse, mantén pulsada la imagen.',
      'get.err': 'Lo sentimos, no se pudo cargar esta tira.', 'get.again': 'Reintentar', 'get.loading': 'Cargando tu tira…'
    },
    ja: {
      'load.1': '写真を現像中…', 'load.2': 'キラキラを追加中…', 'load.3': 'もうすぐ完成…', 'load.templates': 'テンプレートを読み込み中…',
      'welcome.tag': 'ポーズを決めよう。', 'welcome.start': 'スタート',
      'tmpl.title': 'テンプレートを選ぶ', 'tmpl.continue': '次へ',
      'booth.title': 'Timeless Strips', 'btn.capture': '🎞️ ストリップを撮影（{n}枚）',
      'btn.change': '🖼️ テンプレート変更', 'btn.gallery': '🗂️ ギャラリー',
      'edit.title': 'ストリップを編集', 'edit.reset': '↩️ リセット', 'edit.autocrop': '🧠 顔を自動トリミング',
      'edit.retake': '🔁 撮り直す', 'edit.finalize': '✅ 完成',
      'result.title': 'できあがり', 'result.empty': 'ストリップが選ばれていません。撮影するか、下のギャラリーから選んでください。',
      'btn.print': '🖨️ 印刷', 'btn.save': '💾 保存', 'btn.share': '📤 共有', 'btn.phone': '📱 スマホへ',
      'print.paper': '用紙', 'print.copies': '部数', 'print.auto': '撮影のたびに自動で印刷',
      'btn.editagain': '✏️ 再編集', 'btn.new': '📸 新しいストリップ', 'btn.home': '🏠 ホーム',
      'gallery.title': '🖼️ 過去のストリップ',
      'qr.title': 'スマホで受け取る', 'qr.sub': 'スマホのカメラでコードを読み取ってください',
      'qr.making': 'リンクを作成中…', 'qr.share': 'またはリンクを共有', 'qr.copied': 'リンクをコピーしました！', 'qr.copy': 'リンクをコピー',
      'qr.note': 'このリンクを知っている人は誰でも見られます。',
      'qr.nocloud': 'クラウド同期が未設定のため、ダウンロードリンクを作れません。保存か共有をご利用ください。',
      'qr.offline': 'オフラインです。リンクを作るにはインターネットに接続してください。',
      'qr.local': 'このページはお使いのパソコン上で動いているため、スマホからは開けません。ブースのWebアドレスから開いてください。',
      'qr.fail': 'リンクを作れませんでした。もう一度お試しください。',
      'get.title': 'フォトストリップができました！', 'get.sub': 'スマホに保存して、楽しさをシェアしよう。',
      'get.save': '💾 スマホに保存', 'get.share': '友だちに共有', 'get.hint': '保存が始まらないときは、画像を長押ししてください。',
      'get.err': 'このストリップを読み込めませんでした。', 'get.again': '再試行', 'get.loading': '読み込み中…'
    }
  };

  const KEY = 'ts-lang';
  let lang = 'en';
  try {
    const saved = localStorage.getItem(KEY);
    const nav = (navigator.language || 'en').slice(0, 2);
    lang = T[saved] ? saved : (T[nav] ? nav : (nav === 'tl' ? 'fil' : 'en'));
  } catch (e) {}

  const t = (k, vars) => {
    let s = (T[lang] && T[lang][k]) || T.en[k] || k;
    if (vars) Object.keys(vars).forEach((v) => { s = s.replace('{' + v + '}', vars[v]); });
    return s;
  };

  // set the visible text of an element but keep child elements (inputs, selects...)
  function setText(el, str) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = str + ' '; return; }
    }
    if (el.children.length) el.insertBefore(document.createTextNode(str + ' '), el.firstChild);
    else el.textContent = str;
  }

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => setText(el, t(el.dataset.i18n)));
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    const cur = document.getElementById('lang-cur');
    if (cur) cur.innerHTML = FLAGS[lang];
    document.querySelectorAll('.lang-opt').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
    window.dispatchEvent(new Event('langchange'));
  }

  function set(id) {
    if (!T[id]) return;
    lang = id;
    try { localStorage.setItem(KEY, id); } catch (e) {}
    apply();
  }

  function buildSwitch() {
    if (document.getElementById('lang-switch')) return;
    const box = document.createElement('div');
    box.id = 'lang-switch';
    box.innerHTML =
      '<button id="lang-cur" class="lang-cur" type="button" aria-label="Language" aria-haspopup="true"></button>' +
      '<div class="lang-menu" role="menu">' +
      LANGS.map((l) => '<button type="button" class="lang-opt" role="menuitem" data-lang="' + l.id + '" title="' + l.name + '">' +
        '<span class="flag">' + FLAGS[l.id] + '</span><span class="lang-name">' + l.name + '</span></button>').join('') +
      '</div>';
    document.body.appendChild(box);
    const cur = box.querySelector('#lang-cur');
    cur.addEventListener('click', (e) => { e.stopPropagation(); box.classList.toggle('open'); });
    box.querySelectorAll('.lang-opt').forEach((b) => b.addEventListener('click', () => { set(b.dataset.lang); box.classList.remove('open'); }));
    document.addEventListener('click', () => box.classList.remove('open'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') box.classList.remove('open'); });
  }

  function init() { buildSwitch(); apply(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { t, set, apply, get lang() { return lang; } };
})();