import { questionImageURL, nativeFigureID, nativeFigureChunk, loadNativeFigure } from "./assets.mjs";
import { loadImageWhenVisible, pruneLazyImages } from "./lazy-images.mjs";

export function renderRich(root = document.querySelector("#app"), lazyImages = false) {
  pruneLazyImages();
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
    "MARK",
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
    "DETAILS",
    "SUMMARY",
    "IMG",
    "A",
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
    if (node.tagName === "A") {
      try {
        const href = node.getAttribute("href");
        if (!href) throw new Error("Empty link");
        const url = new URL(href, location.href);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
          for (const child of node.childNodes) append(parent, child);
          return;
        }
        target.href = url.href;
        target.target = "_blank";
        target.rel = "noopener noreferrer";
      } catch {
        for (const child of node.childNodes) append(parent, child);
        return;
      }
    }
    if (["TD", "TH"].includes(node.tagName)) {
      for (const name of ["colspan", "rowspan"]) {
        const value = node.getAttribute(name);
        if (/^[1-9]\d?$/.test(value || "")) target.setAttribute(name, value);
      }
    }
    if (
      /^H[1-6]$/.test(node.tagName) &&
      /^knowledge-heading-\d+$/.test(node.id)
    )
      target.id = node.id;
    if (node.tagName === "IMG") {
      try {
        const rawSource = node.getAttribute("src");
        if (!rawSource) return;
        const figureID = nativeFigureID(rawSource);
        const url = new URL(figureID ? location.href : questionImageURL(rawSource));
        if (url.protocol !== "https:" && url.protocol !== "http:") return;
        if (figureID) {
          target.dataset.figureLoading = "true";
          loadImageWhenVisible(target, () => loadNativeFigure(figureID, undefined, undefined, nativeFigureChunk(rawSource)).then(source => {
            target.src = source;
            delete target.dataset.figureLoading;
          }).catch(() => {
            target.alt = "原题插图加载失败，请刷新页面或查看原始资料";
            target.classList.add("image-error");
            delete target.dataset.figureLoading;
          }), lazyImages);
        } else target.src = url.href;
        target.alt = node.getAttribute("alt") ?? "题目图片";
        target.loading = lazyImages ? "lazy" : "eager";
        target.decoding = "async";
        if (figureID || (url.origin === location.origin && /\/question-figures\/[a-f0-9]+\.webp$/.test(url.pathname))) {
          const height = Number(node.getAttribute("data-height"));
          if (node.getAttribute("data-kind") === "formula" && Number.isFinite(height) && height >= 0.2 && height <= 30) {
            target.className = "native-formula-image";
            target.style.height = `${height}em`;
            target.style.width = "auto";
            target.style.maxWidth = "none";
            target.style.verticalAlign = "middle";
          }
        }
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
