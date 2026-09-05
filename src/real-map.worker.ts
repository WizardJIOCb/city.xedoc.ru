import { convertRealMap, type MapResponse } from './real-map';
self.onmessage = (event: MessageEvent<{ data: MapResponse; name: string }>) => {
  try { self.postMessage({ map: convertRealMap(event.data.data, event.data.name) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Не удалось обработать карту.' }); }
};
