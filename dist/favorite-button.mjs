import { icon, attr, button } from './ui.mjs';

export function favoriteButton(id, selected = false) {
  const label = selected ? '取消收藏' : '收藏题目';
  return button(`${icon('star', 19)}<span class="favorite-label">${selected ? '已收藏' : '收藏'}</span>`, 'toggle-favorite',
    `data-id="${attr(id)}" aria-label="${label}" aria-pressed="${selected}" title="${label}"`,
    `icon-btn favorite-button${selected ? ' is-favorite' : ''}`);
}

export function animateFavorite(root, id, reduced = false) {
  if (reduced) return;
  for (const target of root.querySelectorAll('[data-action="toggle-favorite"]')) {
    if (target.dataset.id !== id || target.getAttribute('aria-pressed') !== 'true') continue;
    target.classList.remove('favorite-added');
    void target.offsetWidth;
    target.classList.add('favorite-added');
    target.addEventListener('animationend', () => target.classList.remove('favorite-added'), { once:true });
  }
}
