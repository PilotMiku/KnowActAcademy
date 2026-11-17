import { attr, button } from './ui.mjs';

// Use the decoded originals, including option images, without changing an answer.
export function imageViewerHTML(images) {
  const first = images[0];
  return `${images.length > 1 ? `<div class="image-gallery" role="group" aria-label="选择题图">${images.map((image, index) => {
    const option = image.closest('.option');
    const label = option ? `选项 ${option.dataset.value}` : image.closest('.analysis') ? '解析' : '题干';
    return button(`${label} · ${index + 1}`, 'select-question-image', `data-src="${attr(image.src)}" data-alt="${attr(image.alt)}" data-width="${image.naturalWidth}" aria-pressed="${index === 0}"`, 'btn small');
  }).join('')}</div>` : ''}
    <div class="image-zoom-controls"><label for="image-zoom">缩放</label><input id="image-zoom" type="range" min="50" max="300" step="10" value="100"><output id="image-zoom-value" for="image-zoom">100%</output>${button('还原', 'reset-image-zoom', '', 'btn small')}</div>
    <p class="image-viewer-note">按原图清晰度查看，放大后可左右或上下滚动。</p>
    <div class="image-zoom-viewport" tabindex="0" role="region" aria-label="题图，可滚动查看"><img id="zoomed-image" src="${attr(first.src)}" alt="${attr(first.alt)}" style="width:min(100%,${first.naturalWidth}px)"></div>`;
}

export function updateImageZoom(dialog, percent) {
  const image = dialog.querySelector('#zoomed-image');
  const viewport = dialog.querySelector('.image-zoom-viewport');
  if (!image || !viewport) return;
  // 100% fits the viewport but never stretches a small formula beyond its source.
  const width = Math.min(image.naturalWidth, viewport.clientWidth - 32);
  if (width > 0) image.style.width = `${width * percent / 100}px`;
  dialog.querySelector('#image-zoom-value').textContent = `${percent}%`;
}
