"use client";

export default function TimelinePreview({ transitions }) {
  const safeTransitions = Array.isArray(transitions) ? transitions : [];
  const timelineEnd = Math.max(
    10,
    ...safeTransitions.map((transition) => Number(transition.end || 0))
  );

  return (
    <div>
      <div className="timeline">
        {safeTransitions.length === 0 ? (
          <div className="timeline-empty">No transitions yet</div>
        ) : (
          safeTransitions.map((transition, index) => {
            const start = Number(transition.start || 0);
            const end = Number(transition.end || start);
            const left = `${Math.max(0, (start / timelineEnd) * 100)}%`;
            const width = `${Math.max(1, ((end - start) / timelineEnd) * 100)}%`;
            return (
              <div
                key={`${transition.type}-${index}-${start}-${end}`}
                className="timeline-block"
                style={{ left, width }}
                title={`${transition.type} ${start}s-${end}s (${transition.anchor})`}
              >
                {transition.type}
              </div>
            );
          })
        )}
      </div>
      <div className="timeline-scale">0s - {timelineEnd.toFixed(1)}s</div>
    </div>
  );
}
