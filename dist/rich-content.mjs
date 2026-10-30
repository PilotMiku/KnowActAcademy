import { questionImageURL } from "./assets.mjs";

export function renderRich(root = document.querySelector("#app"), lazyImages = false) {
  for (const el of root.querySelectorAll("[data-rich]")) {
    const content = el.dataset.rich;
    el.removeAttribute("data-rich");
    el.replaceChildren(safeContent(content, lazyImages));
    if (el.closest(".option")) {
      for (const image of el.querySelectorAll("img")) {
        for (const name of ["data-action", "tabindex", "role", "aria-label"]) image.removeAttribute(name);
      }
    }
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(el, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
          ],
          throwOnError: false,
          trust: false,
          strict: "ignore",
          maxExpand: 500,
          maxSize: 10,
        });
      } catch {}
    }
  }
}
function safeContent(value, lazyImages = false) {
  const fragment = document.createDocumentFragment();
  const raw = String(value ?? "");
  if (!/<\/?[a-z][\s\S]*>/i.test(raw)) {
    raw.split(/\n/).forEach((line, i) => {
      if (i) fragment.append(document.createElement("br"));
      fragment.append(document.createTextNode(line));
    });
    return fragment;
  }
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const allowed = new Set([
    "P",
    "DIV",
    "SPAN",
    "BR",
    "STRONG",
    "B",
    "EM",
    "I",
    "U",
    "S",
    "SUP",
    "SUB",
    "UL",
    "OL",
    "LI",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TD",
    "TH",
    "PRE",
    "CODE",
    "BLOCKQUOTE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "IMG",
  ]);
  const drop = new Set([
    "SCRIPT",
    "STYLE",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "FORM",
    "INPUT",
    "BUTTON",
    "SVG",
    "MATH",
    "TEMPLATE",
  ]);
  function append(parent, node) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || drop.has(node.tagName)) return;
    if (!allowed.has(node.tagName)) {
      for (const child of node.childNodes) append(parent, child);
      return;
    }
    const target = document.createElement(
      node.tagName === "H1" ? "h2" : node.tagName.toLowerCase(),
    );
    if (
      /^H[1-6]$/.test(node.tagName) &&
      /^knowledge-heading-\d+$/.test(node.id)
    )
      target.id = node.id;
    if (node.tagName === "IMG") {
      try {
        const rawSource = node.getAttribute("src");
        if (!rawSource) return;
        const url = new URL(questionImageURL(rawSource));
        if (url.protocol !== "https:" && url.protocol !== "http:") return;
        target.src = url.href;
        target.alt = node.getAttribute("alt") ?? "题目图片";
        target.loading = lazyImages ? "lazy" : "eager";
        target.decoding = "async";
        if (
          url.origin === location.origin &&
          /^\/api\/question-image\//.test(rawSource)
        ) {
          target.className = "original-pdf-image";
          target.addEventListener("load", () => {
            target.style.width = `${(target.naturalWidth / 2.5) * 1.5}px`;
          });
          target.addEventListener("error", () => {
            target.alt = "原题图片加载失败，请刷新页面或打开原 PDF";
            target.classList.add("image-error");
          });
        }
        target.referrerPolicy = "no-referrer";
        target.dataset.action = "zoom-image";
        target.tabIndex = 0;
        target.setAttribute("role", "button");
        target.setAttribute("aria-label", `${target.alt || "题目图片"}，点击放大`);
      } catch {
        return;
      }
    }
    for (const child of node.childNodes) append(target, child);
    parent.append(target);
  }
  for (const node of doc.body.childNodes) append(fragment, node);
  return fragment;
}
