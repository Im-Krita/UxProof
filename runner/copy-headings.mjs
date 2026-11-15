// Text stays in the page process. Only bounded aggregate counts cross into the report.
export async function collectDuplicateHeadings(page, { maxElements = 5000, timeoutMs = 2500 } = {}) {
  if (!Number.isInteger(maxElements) || maxElements < 1 || maxElements > 5000 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw TypeError('Invalid copy audit limits');
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Copy audit timeout')), timeoutMs); });
    const result = await Promise.race([page.evaluate(limit => {
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      const groups = new Map(); let seen = 0, node, truncated = false;
      while ((node = walker.nextNode())) {
        if (seen >= limit) { truncated = true; break; }
        seen++;
        if (!node.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')) continue;
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 ||
            rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 ||
            rect.left >= window.innerWidth || rect.top >= window.innerHeight ||
            (typeof node.checkVisibility === 'function' && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) continue;
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
        if (text.length < 3 || text.length > 200) continue;
        groups.set(text, (groups.get(text) || 0) + 1);
      }
      const duplicates = [...groups.values()].filter(count => count >= 2);
      return { duplicateGroups: duplicates.length, duplicateHeadings: duplicates.reduce((sum, count) => sum + count, 0), elementsSeen: seen, truncated };
    }, maxElements), timeout]);
    const fields = ['duplicateGroups', 'duplicateHeadings', 'elementsSeen'];
    if (!result || fields.some(key => !Number.isInteger(result[key]) || result[key] < 0 || result[key] > maxElements) ||
        typeof result.truncated !== 'boolean' || result.duplicateHeadings > result.elementsSeen ||
        result.duplicateGroups * 2 > result.duplicateHeadings) throw TypeError('Invalid copy audit result');
    return { duplicateGroups: result.duplicateGroups, duplicateHeadings: result.duplicateHeadings, elementsSeen: result.elementsSeen, truncated: result.truncated };
  } finally { clearTimeout(timer); }
}
