export type OutlineItem = {
  id: string;
  level: number;
  text: string;
  offset: number;
  line: number;
};

export function parseNoteOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = String(markdown || "").split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      items.push({
        id: `h-${i}-${match[1].length}`,
        level: match[1].length,
        text: match[2].trim(),
        offset,
        line: i,
      });
    }
    offset += line.length + 1;
  }
  return items;
}

export function jumpTextareaToOffset(textarea: HTMLTextAreaElement, offset: number) {
  const pos = Math.max(0, Math.min(offset, textarea.value.length));
  textarea.focus();
  textarea.setSelectionRange(pos, pos);
  const style = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 22;
  const before = textarea.value.slice(0, pos);
  const line = before.split("\n").length;
  const nextTop = Math.max(0, (line - 3) * lineHeight);
  textarea.scrollTop = nextTop;
}
