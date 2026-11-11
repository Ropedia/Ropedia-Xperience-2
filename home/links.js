// The release links: the dataset (Hugging Face), the paper (arXiv) and the code (GitHub). Put each URL here once it is
// out and push; everything marked [data-link] on the page follows it: the three buttons under the hero's slogan, Paper
// and Code in the bar, the bar's "Get the data" and the cards of the Release section (#get, release.css).
// A link left empty: the hero button says "soon" and the card "Coming soon" (neither clickable), Paper and Code stay out
// of the bar, and "Get the data" goes to the Release section instead of Hugging Face.
export const LINKS = {
  dataset: '',   // the dataset page, https://huggingface.co/datasets/<org>/<name>
  paper: '',     // the abstract page, https://arxiv.org/abs/<id>
  code: '',      // the public repository, https://github.com/<org>/<repo>
};

for (const el of document.querySelectorAll('[data-link]')) {
  const url = LINKS[el.dataset.link], small = el.querySelector('small'), go = el.querySelector('.rl-go');
  if (url) {
    el.href = url; el.target = '_blank'; el.rel = 'noopener';
    el.hidden = false; el.classList.remove('soon'); el.removeAttribute('aria-disabled');
    if (small) small.textContent = el.dataset.sub || '';
    if (go && el.dataset.go) go.textContent = el.dataset.go;
  } else if (el.dataset.soonHref) {
    el.href = el.dataset.soonHref;
  } else {
    el.removeAttribute('href'); el.classList.add('soon'); el.setAttribute('aria-disabled', 'true');
  }
}
const ext = document.querySelector('.lnav-ext');
if (ext) ext.hidden = !ext.querySelector('a:not([hidden])');   // no divider in the bar when neither link is out

// The buttons under the slogan. hero.js moves and scales the slogan every frame as the X grows in, so they are placed
// under it each frame; they show with it and are gone after the first bit of scroll, as the Scroll hint is, which steps
// aside where the buttons would cover it (a short window).
const row = document.getElementById('heroLinks'), sub = document.getElementById('lkSub');
const hero = document.getElementById('hero'), hint = document.getElementById('heroHint');
if (row && sub && hero) {
  const stick = row.parentElement;
  let raf = 0;
  const frame = () => {
    raf = 0;
    const p = Math.min(1, Math.max(0, (scrollY - hero.offsetTop) / Math.max(1, hero.offsetHeight - innerHeight)));
    const a = Math.min(1, Number(sub.style.opacity) || 0) * Math.max(0, 1 - p / 0.04);
    if (a > 0.01) {
      const s = sub.getBoundingClientRect(), top = s.bottom - stick.getBoundingClientRect().top + Math.max(16, innerHeight * 0.026);
      row.style.top = `${top}px`;
      if (hint) hint.classList.toggle('aside', top + row.offsetHeight > hint.offsetTop - 6);
    }
    row.style.opacity = a.toFixed(3);
    row.style.visibility = a > 0.01 ? 'visible' : 'hidden';
    if (p < 0.05) raf = requestAnimationFrame(frame);   // follow the slogan while the hero is at its start
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener('scroll', wake, { passive: true });
  addEventListener('resize', wake);
  wake();
}
