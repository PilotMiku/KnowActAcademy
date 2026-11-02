// Reading positions use source hashes so edited documents never restore stale offsets.
export function normalizeReadingPositions(value = {}) {
  const object = v => v && typeof v === "object" && !Array.isArray(v);
  const section = v => typeof v === "string" && /^(all|start|knowledge-heading-[1-9]\d*)$/.test(v);
  if (!object(value) || Object.keys(value).length > 5000 || Object.entries(value).some(([id, p]) =>
    !id || id.length > 150 || !object(p) || !section(p.chapter) ||
    !/^(start|knowledge-heading-[1-9]\d*)$/.test(p.anchor) ||
    !Number.isFinite(p.offset) || p.offset < -10000 || p.offset > 10000000 ||
    typeof p.revision !== "string" || !/^[a-f0-9]{64}$/.test(p.revision)))
    throw new Error("备份中的阅读位置格式错误");
  return Object.fromEntries(Object.entries(value).map(([id, p]) => [id, {
    chapter: p.chapter, anchor: p.anchor, offset: p.offset, revision: p.revision,
  }]));
}

const sectionsCache = new WeakMap();
export function readingSections(article) {
  if (sectionsCache.has(article)) return sectionsCache.get(article);
  if (article.kind !== "note" || article.minutes < 15 || !article.headings.length) return [];
  const level = Math.min(...article.headings.map(h => h.level));
  const starts = [...article.html.matchAll(new RegExp(`<h${level} id="(knowledge-heading-\\d+)">`, "g"))];
  if (starts.length < 2) return [];
  const boundaries = starts.map(m => ({ id: m[1], start: m.index }));
  if (article.html.slice(0, boundaries[0].start).trim()) boundaries.unshift({ id: "start", start: 0 });
  const sections = boundaries.map((item, i) => {
    const html = article.html.slice(item.start, boundaries[i + 1]?.start ?? article.html.length);
    return { id: item.id, title: item.id === "start" ? "开篇" : article.headings.find(h => h.id === item.id).title,
      html, headings: article.headings.filter(h => html.includes(`id="${h.id}"`)) };
  });
  sectionsCache.set(article, sections);
  return sections;
}

export function readingView(article, sources, positions, query) {
  const revision = sources[article.sources[0]?.id]?.sha256 || "";
  const saved = positions?.[article.id];
  const position = saved?.revision === revision ? saved : null;
  const sections = readingSections(article);
  const requested = query.get("chapter") ?? position?.chapter ?? "all";
  const selected = sections.find(s => s.id === requested);
  return { sections, chapter: selected?.id || "all", html: selected?.html ?? article.html,
    headings: selected?.headings ?? article.headings, revision,
    position: position?.chapter === (selected?.id || "all") ? position : null };
}

export function createReadingController({ getState, canSave, schedule, toast }) {
  // The router owns scrolling; browser history restoration can otherwise undo ours.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  let paper = null, ready = false, frame = 0, timer = null;
  function capture(scheduleSave = true) {
    clearTimeout(timer);
    if (!ready || !paper?.isConnected || !canSave()) return;
    const headings = [...paper.querySelectorAll('.reading-content [id^="knowledge-heading-"]')];
    const anchor = headings.filter(h => h.getBoundingClientRect().top <= 115).at(-1);
    const target = anchor || paper;
    const position = { chapter: paper.dataset.readingChapter, anchor: anchor?.id || "start",
      offset: Math.round(-target.getBoundingClientRect().top), revision: paper.dataset.readingRevision };
    const positions = getState().knowledgePositions;
    const id = paper.dataset.readingArticle;
    if (!positions[id] && position.chapter === "all" && window.scrollY === 0) return;
    if (JSON.stringify(positions[id]) !== JSON.stringify(position)) {
      positions[id] = position;
      if (scheduleSave) schedule();
    }
  }
  function detach() {
    capture();
    ready = false;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    paper = null;
  }
  function mount(root) {
    paper = root.querySelector('[data-reading-article]');
    if (!paper) return;
    // Buttons are created after sanitizing; imported HTML cannot add executable controls.
    for (const pre of paper.querySelectorAll('.reading-content pre:has(code)')) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn small code-copy";
      button.textContent = "复制代码";
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(pre.querySelector("code").textContent);
          toast("代码已复制");
        } catch {
          const selection = getSelection(), range = document.createRange();
          range.selectNodeContents(pre.querySelector("code"));
          selection.removeAllRanges(); selection.addRange(range);
          toast("无法自动复制，已选中代码，请手动复制");
        }
      });
      pre.prepend(button);
    }
    const current = paper;
    frame = requestAnimationFrame(() => {
      if (paper !== current) return;
      const saved = getState().knowledgePositions[paper.dataset.readingArticle];
      const valid = saved?.revision === paper.dataset.readingRevision && saved.chapter === paper.dataset.readingChapter;
      const target = valid && saved.anchor !== "start" ? paper.querySelector(`#${saved.anchor}`) : paper;
      const top = valid && target ? window.scrollY + target.getBoundingClientRect().top + saved.offset : 0;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      frame = requestAnimationFrame(() => { ready = true; paper.dataset.readingReady = "true"; });
    });
  }
  window.addEventListener("scroll", () => {
    if (!ready) return;
    clearTimeout(timer);
    timer = setTimeout(capture, 200);
  }, { passive: true });
  return { capture, detach, mount };
}
