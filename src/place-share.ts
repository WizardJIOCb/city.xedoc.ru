import { createPlaceLink, normalizePlace, type SharedPlace } from './place-link';
import { el } from './ui';

export function sharePlace(place: SharedPlace) {
  const p = normalizePlace(place), url = createPlaceLink(p), input = el<HTMLInputElement>('place-share-url'), status = el('place-share-status');
  input.value = url;
  el('place-share-description').textContent = `${p.name} · ${(p.size / 1000).toLocaleString('ru')} × ${(p.size / 1000).toLocaleString('ru')} км · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  el<HTMLDialogElement>('place-share-dialog').showModal();
  const copy = async () => {
    input.focus(); input.select(); input.scrollLeft = 0; status.textContent = 'Копируем ссылку…';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      if (input.value === url) status.textContent = 'Ссылка скопирована. Можно отправлять!';
    } catch {
      if (input.value === url) status.textContent = 'Выделите ссылку и скопируйте её вручную через меню браузера или Ctrl+C.';
    }
  };
  el('place-share-copy').onclick = () => void copy();
  void copy();
}
