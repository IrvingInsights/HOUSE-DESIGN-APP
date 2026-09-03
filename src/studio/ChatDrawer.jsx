// THE CHAT DRAWER — ask for a change in your own words.
//
// A drawer over the right edge rather than a permanent column: the model is
// the thing you came to look at, and a column that is always there takes a
// fifth of it forever. Closed by default; what arrives while it is closed
// badges the button, so a reply never lands unseen.
import React, { useEffect, useRef } from 'react';

export function ChatDrawer({
  messages, prompt, onPrompt, onSend, busy, note, target, onTarget,
  attachments, onAttach, onRemoveAttachment, onPaste, onClose
}) {
  const streamRef = useRef(null);
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="st-chat">
      <div className="st-chat-head">
        <b>Ask</b>
        <button type="button" title="Close (Escape)" onClick={onClose}>×</button>
      </div>
      <div className="st-chat-targets">
        <button type="button" className={target === "design" ? "on" : ""} data-cap="cap-chat-design" onClick={() => onTarget("design")}>Change the design</button>
        <button type="button" className={target === 'team' ? 'on' : ''} data-cap="cap-chat-team" onClick={() => onTarget('team')}>Ask about building it</button>
      </div>
      <div className="st-chat-stream" ref={streamRef}>
        {messages.length === 0 && (
          <div className="st-chat-empty">
            {target === 'design'
              ? 'Say what you want changed, in your own words: "add two bedrooms and a bathroom", "make the kitchen 14 by 12", "move the primary bedroom to the north-east corner". Or attach a floor plan and ask me to read it.'
              : 'Ask about how this house goes together — materials, structure, heat, what a builder would say about it. Nothing you ask here changes the design.'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={`${m.role}-${i}`} className={`st-chat-bubble ${m.role}`}>
            {m.image && <img src={m.image} alt="attached drawing" />}
            {m.speaker && <b>{m.speaker}</b>}
            <span>{m.text}</span>
          </div>
        ))}
        {busy && (
          <div className="st-chat-bubble studio">
            <b>Studio</b>
            <span>{target !== 'design' ? 'Thinking about it…' : attachments.length ? 'Reading your drawing and building the model…' : 'Working out the change…'}</span>
            {/* The progress line is what stands between a six-minute read and
                "the app has frozen". Never remove it. */}
            <small>{note || (attachments.length ? 'A full read of a drawing takes a minute or two: it traces the rooms, checks itself, and corrects what it got wrong.' : 'Usually a few seconds.')}</small>
          </div>
        )}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => onPrompt(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend(); } }}
        placeholder={target === 'design' ? 'What would you like changed?' : 'What would you like to know?'}
      />
      {attachments.length > 0 && (
        <div className="st-chat-tray">
          {attachments.map((f) => (
            <span className="st-chat-chip" key={f.id}>
              {f.kind === 'image' ? <img src={f.src} alt={f.name} /> : <span className="st-chat-doc">PDF</span>}
              <span>{f.name}</span>
              <button type="button" onClick={() => onRemoveAttachment(f.id)} aria-label={`Remove ${f.name}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="st-chat-foot">
        {target === 'design' && (
          <label className="st-chat-upload" data-cap="cap-chat-attach"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onAttach(e.dataTransfer.files?.[0]); }}>
            📎 Add a drawing
            <input type="file" accept="image/*,application/pdf,.pdf,.txt,.md,.csv"
              onChange={(e) => { onAttach(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        )}
        <button type="button" className="st-chat-send" disabled={busy} onClick={onSend}>
          {busy ? 'Working…' : target === 'design' ? 'Make the change' : 'Ask'}
        </button>
      </div>
    </aside>
  );
}
