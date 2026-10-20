import AnswerReview from './AnswerReview';

// The marked paper. An overlay rather than an inline expansion: fifty
// questions unrolled inside a list would bury everything under it, and a
// click on the backdrop puts the student straight back.
// It scrolls itself — alignItems must stay flex-start or a long review
// centres and the first questions go off the top, out of reach.
export default function AnswerReviewOverlay({ review, onClose }) {
  if (!review) return null;
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', zIndex: 1200, padding: 20, overflowY: 'auto' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 820 }}>
        <div className="card" style={{ padding: '14px 18px', marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', position: 'sticky', top: 0, zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {review.title}
          </h2>
          <button className="btn ghost sm" style={{ width: 'auto', flexShrink: 0 }} onClick={onClose}>
            Close
          </button>
        </div>
        {review.rows.length === 0 ? (
          <div className="card" style={{ padding: '16px 18px', color: 'var(--ink-3)', fontSize: 13.5 }}>
            There is nothing to review on this paper — it has no multiple-choice questions.
          </div>
        ) : (
          <AnswerReview rows={review.rows} />
        )}
      </div>
    </div>
  );
}
