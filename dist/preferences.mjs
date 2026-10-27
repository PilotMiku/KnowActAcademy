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
  try { localStorage.setItem("zhixing-ui:" + new URL("./", location.href).pathname, JSON.stringify({ theme: state.theme })); } catch { /* Optional first-paint cache. */ }
  return theme;
}
