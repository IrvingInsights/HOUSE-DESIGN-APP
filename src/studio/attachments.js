// ATTACHING A DRAWING — a photo, a PDF, a text file, read from disk into
// something the planner can be given.
//
// Every failure here has a plain sentence attached to it, because every one of
// them happened to somebody: a cloud-only file that reads back empty, a HEIC
// photo no browser can decode, a 40 MB scan, a Windows file with no MIME type
// at all. Silence on any of these reads as "the app ignored my drawing".
//
// Pure apart from the browser's own file reading: it calls back with either an
// attachment or a sentence, and knows nothing about React.

const MAX_DOC_BYTES = 15 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|tiff?)$/i;
const TEXT_EXT = /\.(txt|md|csv)$/i;

export function readAttachment(file, { onAttach, onProblem }) {
  if (!file) return;
  const say = (text) => onProblem && onProblem(text);
  const done = (src, kind) => onAttach({
    id: `${Date.now()}-${file.name}`, name: file.name, src, size: file.size, kind
  });

  // Windows often reports an empty MIME type — the extension is the fallback.
  const looksLikeImage = String(file.type || '').startsWith('image/') || IMAGE_EXT.test(file.name);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isText = TEXT_EXT.test(file.name) || ['text/plain', 'text/markdown', 'text/csv'].includes(file.type);

  if (isPdf || isText) {
    if (file.size > MAX_DOC_BYTES) {
      say(`"${file.name}" is ${(file.size / 1048576).toFixed(0)} MB — too big to send. Keep it under 15 MB (exporting just the floor-plan page is usually enough).`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = reader.onabort = () => say(cloudNote(file.name));
    reader.onload = () => {
      let src = String(reader.result || '');
      if (!src.startsWith('data:')) { say(emptyNote(file.name)); return; }
      const wanted = isPdf ? 'application/pdf' : 'text/plain';
      if (!src.startsWith(`data:${wanted}`)) src = src.replace(/^data:[^;,]*/, `data:${wanted}`);
      done(src, isPdf ? 'pdf' : 'text');
    };
    reader.readAsDataURL(file);
    return;
  }

  if (!looksLikeImage) {
    say(`"${file.name}" isn't a kind of file I can read. Photos (JPG or PNG), PDFs, and plain text all work.`);
    return;
  }

  const reader = new FileReader();
  reader.onerror = reader.onabort = () => say(cloudNote(file.name));
  reader.onload = () => {
    const raw = String(reader.result || '');
    if (!raw.startsWith('data:')) { say(emptyNote(file.name)); return; }
    // Decode and shrink before attaching: a phone photo is 12 megapixels and
    // the reader needs about one, so this keeps a big drawing fast to send.
    const probe = new Image();
    probe.onload = () => {
      const longest = Math.max(probe.width, probe.height);
      if (longest > 1600) {
        const scale = 1600 / longest;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(probe.width * scale);
        canvas.height = Math.round(probe.height * scale);
        canvas.getContext('2d').drawImage(probe, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.85), 'image');
      } else {
        done(raw, 'image');
      }
    };
    probe.onerror = () => {
      const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/.test(String(file.type));
      say(heic
        ? `"${file.name}" is a HEIC photo, which browsers cannot open. Export it as a JPG or PNG (a screenshot works) and add that instead.`
        : `I can't open "${file.name}" here. A JPG, PNG, or screenshot will work.`);
    };
    probe.src = raw;
  };
  reader.readAsDataURL(file);
}

// A pasted screenshot is the fastest way to show the app a drawing.
export function attachmentFromPaste(event) {
  const item = Array.from(event.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
  return item ? item.getAsFile() : null;
}

const cloudNote = (name) => `I couldn't read "${name}" from the disk. If it lives in cloud storage (Google Drive, OneDrive), it may be online-only — open it once, or copy it somewhere local, and try again.`;
const emptyNote = (name) => `I couldn't read "${name}" — it came back empty. Try copying it somewhere local first.`;
