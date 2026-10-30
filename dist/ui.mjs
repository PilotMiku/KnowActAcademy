const paths = {
  home: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z M9 21v-8h6v8",
  book: "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z M13 7a3 3 0 0 1 3-3h5v14h-4a4 4 0 0 0-4 3",
  exam: "M7 4h10v3H7z M7 5H5v16h14V5h-2 M8 12h8 M8 16h5",
  mistake: "M14 3H5v18h14V8z M14 3v5h5 M9 12l6 5 M15 12l-6 5",
  star: "m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4-4.6-4.5 6.4-.9Z",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  folder: "M3 7V4h6l2 3h10v13H3z",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  search: "M20 20l-5-5 M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14",
  moon: "M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M19 5l-1.5 1.5 M6.5 17.5 5 19",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "M6 6l12 12 M18 6 6 18",
  check: "m5 12 4 4L19 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2",
  flame:
    "M13 3c2 5 6 6 6 11a7 7 0 0 1-14 0c0-3 2-5 4-7 0 3 1 4 2 4 2-2 2-5 2-8Z",
  upload: "M12 16V3 M7 8l5-5 5 5 M4 14v6h16v-6",
  download: "M12 3v13 M7 11l5 5 5-5 M4 16v5h16v-5",
  settings:
    "M9.13 5.07L10.19 4.72L10.26 2.15L13.74 2.15L13.81 4.72L14.87 5.07L14.87 5.07L15.86 5.57L17.74 3.81L20.19 6.26L18.43 8.14L18.93 9.13L18.93 9.13L19.28 10.19L21.85 10.26L21.85 13.74L19.28 13.81L18.93 14.87L18.93 14.87L18.43 15.86L20.19 17.74L17.74 20.19L15.86 18.43L14.87 18.93L14.87 18.93L13.81 19.28L13.74 21.85L10.26 21.85L10.19 19.28L9.13 18.93L9.13 18.93L8.14 18.43L6.26 20.19L3.81 17.74L5.57 15.86L5.07 14.87L5.07 14.87L4.72 13.81L2.15 13.74L2.15 10.26L4.72 10.19L5.07 9.13L5.07 9.13L5.57 8.14L3.81 6.26L6.26 3.81L8.14 5.57L9.13 5.07Z M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6",
  leaf: "M20 3C9 3 3 8 5 16c8 5 15-2 15-13Z M4 21 15 9",
  target:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  plus: "M12 4v16 M4 12h16",
  refresh: "M20 7v5h-5 M20 12a8 8 0 1 0-2 6",
  lock: "M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z",
  back: "M19 12H5 M11 6l-6 6 6 6",
  trash: "M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 11v6 M12 7h.01",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
};
function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.book}"/></svg>`;
}
function brandIcon(theme = "light") {
  const light = "./assets/brand/icon-light.png", dark = "./assets/brand/icon-dark.png";
  return `<img src="${theme === "dark" ? dark : light}" data-theme-asset data-light-src="${light}" data-dark-src="${dark}" width="48" height="48" alt="">`;
}
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
const attr = esc;
function button(label, action, extra = "", className = "btn") {
  return `<button type="button" class="${className}" data-action="${action}" ${extra}>${label}</button>`;
}
function head(title, description, action = "") {
  return `<header class="page-head"><div><div class="eyebrow">知行学习 · 学习空间</div><h1>${title}</h1>${description ? `<p class="subtitle">${description}</p>` : ""}</div>${action}</header>`;
}

function empty(
  title,
  description,
  action = `${button(`${icon("upload", 15)} 导入原题`, "choose-file", "", "btn primary")}`,
) {
  return `<div class="empty"><div class="empty-symbol">${icon("book", 27)}</div><h2>${title}</h2><p>${description}</p><div class="flex">${action}</div></div>`;
}

export { icon, brandIcon, esc, attr, button, head, empty };
