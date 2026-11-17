import { attr, button } from './ui.mjs';
import { readableFormula } from './readable-formulas.mjs';
import { loadNativeFigure } from './assets.mjs';
import { renderRich } from './rich-content.mjs';

function selection(item) {
  return item.dataset.originalFigure
    ? { figure: item.dataset.originalFigure, version: item.dataset.figureVersion }
    : { src: item.src, alt: item.alt, width: item.naturalWidth };
}

function selectionHTML(item) {
  const latex = item.figure && readableFormula(item.figure, item.version);
  if (latex) return `<div class="formula-view" data-figure="${attr(item.figure)}" data-version="${attr(item.version)}">
      <div class="formula-source-control">${button('对照原图', 'toggle-formula-original', 'aria-pressed="false"', 'btn small')}</div>
      <div class="zoomed-formula rich" data-rich="${attr('\\(\\displaystyle ' + latex + '\\)')}"></div>
    </div>`;
  return `<img id="zoomed-image" src="${attr(item.src)}" alt="${attr(item.alt)}" style="width:min(100%,${Number(item.width)}px)">`;
}

// Include source-checked typesetting and option formulas without changing an answer.
export function imageViewerHTML(images) {
  return `${images.length > 1 ? `<div class="image-gallery" role="group" aria-label="选择题图">${images.map((image, index) => {
    const option = image.closest('.option');
    const label = option ? `选项 ${option.dataset.value}` : image.closest('.analysis') ? '解析' : '题干';
    const item = selection(image);
    const source = item.figure ? `data-figure="${attr(item.figure)}" data-version="${attr(item.version)}"` : `data-src="${attr(item.src)}" data-alt="${attr(item.alt)}" data-width="${item.width}"`;
    return button(`${label} · ${index + 1}`, 'select-question-image', `${source} aria-pressed="${index === 0}"`, 'btn small');
  }).join('')}</div>` : ''}
    <div class="image-zoom-controls"><label for="image-zoom">缩放</label><input id="image-zoom" type="range" min="50" max="300" step="10" value="100"><output id="image-zoom-value" for="image-zoom">100%</output>${button('还原', 'reset-image-zoom', '', 'btn small')}</div>
    <p class="image-viewer-note">清晰公式支持无损缩放，可对照原图。长公式与题图可左右或上下滚动。</p>
    <div class="image-zoom-viewport" tabindex="0" role="region" aria-label="题图与公式，可滚动查看">${selectionHTML(selection(images[0]))}</div>`;
}

export function selectQuestionImage(dialog, control) {
  const viewport = dialog.querySelector('.image-zoom-viewport');
  viewport.innerHTML = selectionHTML(control.dataset);
  renderRich(viewport);
  for (const item of dialog.querySelectorAll('[data-action="select-question-image"]'))
    item.setAttribute('aria-pressed', String(item === control));
  dialog.querySelector('#image-zoom').value = '100';
  updateImageZoom(dialog, 100);
  viewport.scrollTo(0, 0);
}

export async function toggleFormulaOriginal(dialog, control) {
  const view = control.closest('.formula-view');
  if (!view) return;
  const formula = view.querySelector('.zoomed-formula');
  const show = control.getAttribute('aria-pressed') !== 'true';
  if (show && !view.querySelector('img')) {
    control.disabled = true;
    try {
      const source = await loadNativeFigure(view.dataset.figure, undefined, undefined, view.dataset.version);
      if (!view.isConnected) return;
      const image = document.createElement('img');
      image.id = 'zoomed-image'; image.src = source; image.alt = '公式原图';
      view.append(image);
      // Match ordinary image zoom after the browser has decoded the original.
      image.addEventListener('load', () => updateImageZoom(dialog, Number(dialog.querySelector('#image-zoom')?.value) || 100), { once: true });
    } catch {
      if (view.isConnected) control.textContent = '加载失败，点击重试';
      return;
    } finally { control.disabled = false; }
  }
  formula.hidden = show;
  view.querySelector('img').hidden = !show;
  control.setAttribute('aria-pressed', String(show));
  control.textContent = show ? '返回清晰公式' : '对照原图';
  updateImageZoom(dialog, Number(dialog.querySelector('#image-zoom').value));
}

export function updateImageZoom(dialog, percent) {
  const image = dialog.querySelector('#zoomed-image');
  const viewport = dialog.querySelector('.image-zoom-viewport');
  if (!viewport) return;
  const formula = viewport.querySelector('.zoomed-formula');
  if (formula) formula.style.fontSize = `${22 * percent / 100}px`;
  // 100% fits the viewport but never stretches a small formula beyond its source.
  const width = Math.min(image?.naturalWidth || 0, viewport.clientWidth - 32);
  if (width > 0) image.style.width = `${width * percent / 100}px`;
  dialog.querySelector('#image-zoom-value').textContent = `${percent}%`;
}
