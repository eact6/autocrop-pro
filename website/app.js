document.addEventListener('DOMContentLoaded', () => {

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Theme (dark default, html.dark for dark mode) ─────────────
  const root = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');

  function applyTheme(theme) {
    const isDark = theme !== 'light';
    root.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    if (themeToggle) {
      themeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      themeToggle.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#000000' : '#f6f7fb');
  }

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    applyTheme('light');
  } else {
    applyTheme('dark');
  }

  themeToggle?.addEventListener('click', () => {
    const isDark = root.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  });

  // ── Mobile nav + overlay ──────────────────────────────────────
  const navToggle = document.getElementById('nav-toggle');
  const navMobile = document.getElementById('nav-mobile');
  const navOverlay = document.getElementById('nav-overlay');

  function setNavOpen(open) {
    navToggle?.setAttribute('aria-expanded', String(open));
    navMobile?.classList.toggle('open', open);
    navOverlay?.classList.toggle('open', open);
    navMobile?.toggleAttribute('hidden', !open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  navToggle?.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') === 'true';
    setNavOpen(!open);
  });

  navOverlay?.addEventListener('click', () => setNavOpen(false));

  navMobile?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => setNavOpen(false));
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && navToggle?.getAttribute('aria-expanded') === 'true') {
      setNavOpen(false);
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && navToggle?.getAttribute('aria-expanded') === 'true') {
      setNavOpen(false);
    }
  });

  // ── Scroll progress + header ──────────────────────────────────
  const scrollProgress = document.getElementById('scroll-progress');
  const header = document.getElementById('site-header');

  function onScroll() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

    if (scrollProgress) scrollProgress.style.width = pct + '%';
    header?.classList.toggle('scrolled', scrollTop > 40);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── Reveal on scroll ──────────────────────────────────────────
  const revealEls = document.querySelectorAll('.reveal');

  if (prefersReducedMotion) {
    revealEls.forEach(el => el.classList.add('visible'));
  } else {
    const revealObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach(el => revealObserver.observe(el));
  }

  // ── Stat counters ─────────────────────────────────────────────
  const statNumbers = document.querySelectorAll('.stat-number[data-target]');

  if (prefersReducedMotion) {
    statNumbers.forEach(el => {
      const target = parseInt(el.dataset.target, 10);
      el.textContent = target + (el.dataset.suffix || '');
    });
    document.querySelectorAll('.stat-number[data-text]').forEach(el => {
      el.textContent = el.dataset.text;
    });
  } else {
    const statsObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const target = parseInt(el.dataset.target, 10);
          const suffix = el.dataset.suffix || '';
          const duration = 1200;
          const start = performance.now();

          function tick(now) {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(target * eased) + suffix;
            if (progress < 1) requestAnimationFrame(tick);
          }

          requestAnimationFrame(tick);
          statsObserver.unobserve(el);
        });
      },
      { threshold: 0.5 }
    );

    statNumbers.forEach(el => statsObserver.observe(el));

    document.querySelectorAll('.stat-number[data-text]').forEach(el => {
      const textObserver = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.textContent = entry.target.dataset.text;
              textObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.5 }
      );
      textObserver.observe(el);
    });
  }

  // ── Steps progress on scroll ──────────────────────────────────
  const stepsSection = document.getElementById('how-it-works');
  const stepsFill = document.getElementById('steps-progress-fill');
  const stepCards = document.querySelectorAll('.step-card');

  if (stepsSection && stepsFill) {
    if (prefersReducedMotion) {
      stepsFill.style.width = '100%';
      stepCards.forEach(card => card.classList.add('active'));
    } else {
      const stepsObserver = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const ratio = entry.intersectionRatio;
            const idx = Math.min(Math.floor(ratio * 3) + (ratio > 0.3 ? 1 : 0), 3);
            stepsFill.style.width = (idx / 3 * 100) + '%';
            stepCards.forEach((card, i) => {
              card.classList.toggle('active', i < idx);
            });
          });
        },
        { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-20% 0px' }
      );
      stepsObserver.observe(stepsSection);

      window.addEventListener('scroll', () => {
        const rect = stepsSection.getBoundingClientRect();
        const vh = window.innerHeight;
        if (rect.top < vh * 0.7 && rect.bottom > vh * 0.3) {
          const progress = Math.min(Math.max((vh * 0.7 - rect.top) / (rect.height * 0.6), 0), 1);
          stepsFill.style.width = (progress * 100) + '%';
          const activeStep = Math.min(Math.ceil(progress * 3), 3);
          stepCards.forEach((card, i) => card.classList.toggle('active', i < activeStep));
        }
      }, { passive: true });
    }
  }

  // ── Pain track carousel ───────────────────────────────────────
  const painTrack = document.getElementById('pain-track');
  const painWrap = painTrack?.closest('.pain-scroll-wrap');
  const painPrev = document.getElementById('pain-prev');
  const painNext = document.getElementById('pain-next');
  const painDots = document.getElementById('pain-dots');

  if (painTrack) {
    const painCards = [...painTrack.querySelectorAll('.pain-card')];
    let isDown = false;
    let startX;
    let scrollLeft;

    painCards.forEach((card, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'pain-dot' + (index === 0 ? ' is-active' : '');
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `Go to problem ${index + 1}`);
      dot.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      dot.addEventListener('click', () => scrollToCard(index));
      painDots?.appendChild(dot);
    });

    const dots = painDots ? [...painDots.querySelectorAll('.pain-dot')] : [];

    function scrollToCard(index) {
      const card = painCards[index];
      if (!card) return;
      const offset = card.offsetLeft - painTrack.offsetLeft;
      painTrack.scrollTo({ left: offset, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    }

    function getActiveIndex() {
      const trackLeft = painTrack.scrollLeft;
      let closest = 0;
      let minDist = Infinity;
      painCards.forEach((card, i) => {
        const dist = Math.abs(card.offsetLeft - painTrack.offsetLeft - trackLeft);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      });
      return closest;
    }

    function updatePainCarousel() {
      const active = getActiveIndex();
      const maxScroll = painTrack.scrollWidth - painTrack.clientWidth;
      const atStart = painTrack.scrollLeft <= 4;
      const atEnd = painTrack.scrollLeft >= maxScroll - 4;

      painWrap?.classList.toggle('can-scroll-left', !atStart);
      painWrap?.classList.toggle('can-scroll-right', !atEnd);

      if (painPrev) painPrev.hidden = atStart;
      if (painNext) painNext.hidden = atEnd;

      painCards.forEach((card, i) => card.classList.toggle('is-active', i === active));
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-active', i === active);
        dot.setAttribute('aria-selected', i === active ? 'true' : 'false');
      });
    }

    painPrev?.addEventListener('click', () => scrollToCard(Math.max(getActiveIndex() - 1, 0)));
    painNext?.addEventListener('click', () => scrollToCard(Math.min(getActiveIndex() + 1, painCards.length - 1)));

    function endPainDrag() {
      isDown = false;
      painTrack.style.scrollSnapType = '';
      painTrack.classList.remove('is-dragging');
    }

    painTrack.addEventListener('wheel', e => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      window.scrollBy({ top: e.deltaY, left: 0, behavior: 'auto' });
    }, { passive: false });

    painTrack.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      isDown = true;
      startX = e.pageX;
      scrollLeft = painTrack.scrollLeft;
      painTrack.style.scrollSnapType = 'none';
    });

    document.addEventListener('mouseup', endPainDrag);

    painTrack.addEventListener('mousemove', e => {
      if (!isDown) return;
      const walk = e.pageX - startX;
      if (Math.abs(walk) < 4) return;
      painTrack.classList.add('is-dragging');
      e.preventDefault();
      painTrack.scrollLeft = scrollLeft - walk * 1.5;
    });

    painTrack.addEventListener('scroll', updatePainCarousel, { passive: true });
    window.addEventListener('resize', updatePainCarousel);
    updatePainCarousel();
  }

  // ── Before / After compare ────────────────────────────────────
  const compareRange = document.getElementById('compare-range');
  const compareAfter = document.querySelector('.compare-after');
  const compareHandle = document.getElementById('compare-handle');

  function updateCompare(val) {
    if (compareAfter) compareAfter.style.clipPath = `inset(0 0 0 ${val}%)`;
    if (compareHandle) compareHandle.style.left = val + '%';
  }

  compareRange?.addEventListener('input', e => updateCompare(e.target.value));
  updateCompare(compareRange?.value || 50);

  // ── Crop tolerance simulator ──────────────────────────────────
  const toleranceSlider = document.getElementById('tolerance-slider');
  const toleranceValue = document.getElementById('tolerance-value');
  const cropBox = document.getElementById('crop-box');
  const cropDims = document.getElementById('crop-dims');
  const simStatLeft = document.getElementById('sim-stat-left');
  const simStatRight = document.getElementById('sim-stat-right');

  function updateCropSimulator(tolerance) {
    if (!cropBox) return;

    toleranceValue.textContent = tolerance + '%';
    toleranceSlider?.setAttribute('aria-valuenow', tolerance);

    let boxTop = 0, boxHeight = 100, boxLeft = 0, boxWidth = 100;
    let w = 1920, h = 1080;
    let leftText = 'Sweeping pixels…';
    let rightText = 'Algorithm idle';
    let rightClass = 'sim-stat';

    if (tolerance < 13) {
      leftText = 'Borders ignored — too conservative';
      rightText = 'Tolerance too low';
      rightClass = 'sim-stat sim-stat-warn';
    } else if (tolerance <= 45) {
      boxTop = 12;
      boxHeight = 76;
      w = 1920;
      h = 800;
      leftText = 'Exact borders detected';
      rightText = 'Optimal sweep';
      rightClass = 'sim-stat sim-stat-ok';
    } else {
      const scale = (tolerance - 45) / 55;
      const indentY = 12 + scale * 25;
      const indentX = scale * 30;
      boxTop = indentY;
      boxHeight = 100 - indentY * 2;
      boxLeft = indentX;
      boxWidth = 100 - indentX * 2;
      w = Math.round(1920 * (boxWidth / 100));
      h = Math.round(1080 * (boxHeight / 100));
      leftText = 'Content clipped';
      rightText = 'Too aggressive';
      rightClass = 'sim-stat sim-stat-danger';
    }

    cropBox.style.top = boxTop + '%';
    cropBox.style.height = boxHeight + '%';
    cropBox.style.left = boxLeft + '%';
    cropBox.style.width = boxWidth + '%';
    cropDims.textContent = w + ' × ' + h;
    simStatLeft.textContent = leftText;
    simStatRight.textContent = rightText;
    simStatRight.className = rightClass;
  }

  toleranceSlider?.addEventListener('input', e => updateCropSimulator(parseInt(e.target.value, 10)));
  updateCropSimulator(parseInt(toleranceSlider?.value || '20', 10));

  // ── Batch simulator ───────────────────────────────────────────
  const btnRunBatch = document.getElementById('btn-run-batch');
  const consoleOutput = document.getElementById('console-output');

  const queueItems = [
    {
      fillId: 'fill-1', pctId: 'pct-1', statusId: 'status-1', time: 280,
      logs: [
        { text: '[INFO] Processing IMG_0412.JPG (1/4)', cls: 'log-info' },
        { text: '[RUST] Edge sweep — tolerance 20%', cls: 'log-system' },
        { text: '[RUST] Histogram: top=130px, bottom=130px', cls: 'log-info' },
        { text: '[OK] IMG_0412_cropped.png → lossless PNG', cls: 'log-success' }
      ]
    },
    {
      fillId: 'fill-2', pctId: 'pct-2', statusId: 'status-2', time: 750,
      logs: [
        { text: '[INFO] Processing VLOG_JUNE_2026.MP4 (2/4)', cls: 'log-info' },
        { text: '[FFMPEG] cropdetect on 30 frames…', cls: 'log-system' },
        { text: '[FFMPEG] crop=1920:800:0:130', cls: 'log-info' },
        { text: '[OK] VLOG_JUNE_2026_cropped.mp4 encoded', cls: 'log-success' }
      ]
    },
    {
      fillId: 'fill-3', pctId: 'pct-3', statusId: 'status-3', time: 180,
      logs: [
        { text: '[INFO] Processing SCREENSHOT_02.PNG (3/4)', cls: 'log-info' },
        { text: '[RUST] Solid border #000000 detected', cls: 'log-system' },
        { text: '[OK] SCREENSHOT_02_cropped.png written', cls: 'log-success' }
      ]
    },
    {
      fillId: 'fill-4', pctId: 'pct-4', statusId: 'status-4', time: 950,
      logs: [
        { text: '[INFO] Processing CLIP_REEL.MKV (4/4)', cls: 'log-info' },
        { text: '[FFMPEG] Letterboxes detected', cls: 'log-system' },
        { text: '[RUST] Rayon thread assigned', cls: 'log-info' },
        { text: '[OK] CLIP_REEL_cropped.mkv complete', cls: 'log-success' }
      ]
    }
  ];

  function log(text, cls) {
    if (!consoleOutput) return;
    const line = document.createElement('div');
    line.className = 'log-line ' + (cls || 'log-info');
    line.textContent = '> ' + text;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  async function processItem(item) {
    const fill = document.getElementById(item.fillId);
    const pct = document.getElementById(item.pctId);
    const status = document.getElementById(item.statusId);

    status.textContent = 'Processing';
    status.className = 'batch-status processing';

    item.logs.slice(0, 2).forEach(l => log(l.text, l.cls));

    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, item.time / steps));
      if (fill) fill.style.width = (i * 10) + '%';
      if (pct) pct.textContent = (i * 10) + '%';
    }

    item.logs.slice(2).forEach(l => log(l.text, l.cls));
    status.textContent = 'Done';
    status.className = 'batch-status done';
  }

  btnRunBatch?.addEventListener('click', async () => {
    btnRunBatch.disabled = true;
    btnRunBatch.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> Processing…';

    if (consoleOutput) consoleOutput.innerHTML = '';

    queueItems.forEach(item => {
      const fill = document.getElementById(item.fillId);
      const pct = document.getElementById(item.pctId);
      const status = document.getElementById(item.statusId);
      if (fill) fill.style.width = '0%';
      if (pct) pct.textContent = '0%';
      if (status) { status.textContent = 'Queued'; status.className = 'batch-status'; }
    });

    log('AutoCrop Pro Rust core v0.1.4', 'log-system');
    await new Promise(r => setTimeout(r, 150));
    log('Spawning Rayon worker threads…', 'log-info');
    await new Promise(r => setTimeout(r, 200));
    log('Output: Documents/AutoCrop_Output/', 'log-warning');

    const t0 = performance.now();
    for (const item of queueItems) {
      await processItem(item);
      await new Promise(r => setTimeout(r, 120));
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    log('Batch complete — 4 files in ' + elapsed + 's', 'log-success');

    btnRunBatch.disabled = false;
    btnRunBatch.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run again';
  });

  // ── FAQ accordion ─────────────────────────────────────────────
  document.querySelectorAll('.faq-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.faq-item');
      const panel = item?.querySelector('.faq-panel');
      const isOpen = item?.classList.contains('open');

      document.querySelectorAll('.faq-item').forEach(other => {
        other.classList.remove('open');
        const p = other.querySelector('.faq-panel');
        if (p) p.style.maxHeight = '0';
        other.querySelector('.faq-trigger')?.setAttribute('aria-expanded', 'false');
      });

      if (!isOpen && item && panel) {
        item.classList.add('open');
        panel.style.maxHeight = panel.scrollHeight + 'px';
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // ── Smooth anchor offset for floating header ──────────────────
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const id = anchor.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const offset = 100;
      const y = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });
  });

});
