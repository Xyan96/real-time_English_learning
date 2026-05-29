import { dedupeLearningItems } from './deduper.js';

export function normalizeExportableLearningItems(items) {
  return dedupeLearningItems(items)
    .filter((item) => item.exportable !== false)
    .map((item) => ({
      ...item,
      text: item.expression,
      translation: item.meaning_zh,
    }));
}

export function mergeLearningItemIntoLibrary(libraryItems, newItem) {
  const merged = dedupeLearningItems([...Array.from(libraryItems ?? []), newItem]);
  return merged.filter((item) => item.exportable !== false);
}
