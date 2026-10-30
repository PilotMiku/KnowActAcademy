export const defaultStudySettings = () => ({ fontSize: "normal", lineSpacing: "normal", focus: false });
export function normalizeStudySettings(value) {
  return { fontSize: ["normal", "large", "larger"].includes(value?.fontSize) ? value.fontSize : "normal",
    lineSpacing: value?.lineSpacing === "relaxed" ? "relaxed" : "normal", focus: value?.focus === true };
}
export function resolvedTheme(theme, systemDark = false) {
  return theme === "dark" || theme === "system" && systemDark ? "dark" : "light";
}
export function applyPreferences(state) {
  const theme = resolvedTheme(state.theme, matchMedia("(prefers-color-scheme: dark)").matches);
  const settings = normalizeStudySettings(state.studySettings);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.body.classList.toggle("dark", theme === "dark");
  document.body.classList.toggle("focus-study", settings.focus);
  document.body.dataset.fontSize = settings.fontSize;
  document.body.dataset.lineSpacing = settings.lineSpacing;
  for (const element of document.querySelectorAll("[data-theme-asset]")) {
    const source = element.dataset[theme === "dark" ? "darkSrc" : "lightSrc"];
    const attribute = element.tagName === "LINK" ? "href" : "src";
    if (element.getAttribute(attribute) !== source) element.setAttribute(attribute, source);
  }
  try { localStorage.setItem("zhixing-ui:" + new URL("./", location.href).pathname, JSON.stringify({ theme: state.theme })); } catch { /* Optional first-paint cache. */ }
  return theme;
}
