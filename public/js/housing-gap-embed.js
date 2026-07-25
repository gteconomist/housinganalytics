/* housing-gap-embed.js — lazy renders the analysis block on a profile page.
   Container: <div data-hg-embed data-geoid="1315172" data-st="13" data-mode="city"></div>
   Per conventions.md, the per-geography model is fetched ON DEMAND (state bundle),
   NOT bundled into the profile payload. Requires housing-gap.js + housing-gap.css. */
(function () {
  const cache = {};
  async function load(el) {
    const { geoid, st, mode } = el.dataset;
    el.innerHTML = '<p class="hg-src">Loading housing gap analysis…</p>';
    try {
      if (!cache[st]) cache[st] = await fetch(`/analysis-data/states/${st}.json`).then((r) => r.json());
      const b = cache[st];
      const rec = (mode === 'county' ? b.counties : b.places)[geoid];
      if (!rec) { el.innerHTML = ''; return; }
      window.HousingGap.render(el, rec.model, { name: rec.name, state_name: el.dataset.stateName || '', model: rec.model });
    } catch (e) { el.innerHTML = '<p class="hg-src">Housing gap analysis unavailable.</p>'; }
  }
  function init() {
    const els = document.querySelectorAll('[data-hg-embed]');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) { els.forEach(load); return; }
    const io = new IntersectionObserver((ents, o) => {
      ents.forEach((e) => { if (e.isIntersecting) { o.unobserve(e.target); load(e.target); } });
    }, { rootMargin: '200px' });
    els.forEach((el) => io.observe(el));
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
