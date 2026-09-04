import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const loader = html.match(/<script[^>]*data-metrika="112296372"[^>]*>([\s\S]*?)<\/script>/)[1];
function page(hostname) {
  const scripts = [], context = { location: { hostname, href: `https://${hostname}/` } };
  const first = { src: '', parentNode: { insertBefore: element => scripts.push(element) } }; scripts.push(first);
  context.document = { scripts, referrer: 'https://example.org/', createElement: () => ({}), getElementsByTagName: () => scripts };
  context.window = context; vm.createContext(context); return { context, scripts };
}
test('Metrika starts the supplied counter once with Webvisor, click map and link tracking', () => {
  const { context, scripts } = page('city.xedoc.ru'); vm.runInContext(loader, context); vm.runInContext(loader, context);
  assert.equal(scripts.length, 2); assert.equal(scripts[1].async, 1);
  assert.equal(scripts[1].src, 'https://mc.yandex.ru/metrika/tag.js?id=112296372');
  assert.equal(context.ym.a.length, 1); const [id, command, options] = context.ym.a[0];
  assert.equal(id, 112296372); assert.equal(command, 'init');
  for (const key of ['ssr', 'webvisor', 'clickmap', 'accurateTrackBounce', 'trackLinks']) assert.equal(options[key], true);
  assert.equal(options.ecommerce, 'dataLayer'); assert.equal(options.url, context.location.href); assert.equal(options.referrer, context.document.referrer);
});
test('local development does not load analytics or enqueue visits', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) { const { context, scripts } = page(hostname); vm.runInContext(loader, context); assert.equal(scripts.length, 1); assert.equal(context.ym, undefined); }
});
