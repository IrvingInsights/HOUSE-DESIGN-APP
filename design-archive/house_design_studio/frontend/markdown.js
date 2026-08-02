"use strict";
/*
 * Minimal, self-contained Markdown -> HTML renderer.
 * Bundled locally (no CDN) so the app works fully offline. It covers exactly
 * what the Design Basis report emits: headings, hr, blockquotes, ordered and
 * unordered lists, GitHub-style tables, and inline bold / italic / code.
 * All text is HTML-escaped before inline formatting, so report content
 * (including the user's own words) cannot inject markup.
 */
window.renderMarkdown = (function () {
  function esc(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function inline(s) {
    // Order matters: escape first, then apply formatting on the safe string.
    let t = esc(s);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
    return t;
  }

  function isTableSep(line) {
    return /^\s*\|?[:\-\s|]+\|[:\-\s|]*$/.test(line) && line.includes("-");
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  }

  return function renderMarkdown(md) {
    const lines = md.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    const flushParagraph = (buf) => {
      if (buf.length) out.push("<p>" + inline(buf.join(" ")) + "</p>");
      buf.length = 0;
    };

    const para = [];

    while (i < lines.length) {
      const line = lines[i];

      // Blank line
      if (!line.trim()) { flushParagraph(para); i++; continue; }

      // Horizontal rule
      if (/^---+$/.test(line.trim())) { flushParagraph(para); out.push("<hr>"); i++; continue; }

      // Headings
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushParagraph(para);
        const level = h[1].length;
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
        i++; continue;
      }

      // Blockquote (consecutive > lines)
      if (/^>\s?/.test(line)) {
        flushParagraph(para);
        const quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(inline(lines[i].replace(/^>\s?/, "")));
          i++;
        }
        out.push("<blockquote>" + quote.join("<br>") + "</blockquote>");
        continue;
      }

      // Table (header line followed by a separator line)
      if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushParagraph(para);
        const header = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        let t = "<table><thead><tr>";
        header.forEach((c) => (t += "<th>" + inline(c) + "</th>"));
        t += "</tr></thead><tbody>";
        rows.forEach((r) => {
          t += "<tr>";
          r.forEach((c) => (t += "<td>" + inline(c) + "</td>"));
          t += "</tr>";
        });
        t += "</tbody></table>";
        out.push(t);
        continue;
      }

      // Unordered list
      if (/^\s*[-*]\s+/.test(line)) {
        flushParagraph(para);
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push("<li>" + inline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>");
          i++;
        }
        out.push("<ul>" + items.join("") + "</ul>");
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        flushParagraph(para);
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push("<li>" + inline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>");
          i++;
        }
        out.push("<ol>" + items.join("") + "</ol>");
        continue;
      }

      // Plain paragraph text
      para.push(line.trim());
      i++;
    }
    flushParagraph(para);
    return out.join("\n");
  };
})();
