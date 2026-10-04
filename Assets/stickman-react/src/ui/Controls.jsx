const PAD = [["↖", -1, -1], ["↑", 0, -1], ["↗", 1, -1], ["←", -1, 0], null, ["→", 1, 0], ["↙", -1, 1], ["↓", 0, 1], ["↘", 1, 1]];

/** 8-way hold-to-move pad + action buttons. */
export default function Controls({ input, onAction }) {
  return (
    <div className="controls">
      <div className="dpad">
        {PAD.map((b, i) => b ? (
          <button key={i} className="pad"
            onPointerDown={(e) => { e.preventDefault(); input.setPad(b[1], b[2]); }}
            onPointerUp={() => input.setPad(0, 0)}
            onPointerLeave={() => input.setPad(0, 0)}
            onPointerCancel={() => input.setPad(0, 0)}>{b[0]}</button>
        ) : <button key={i} onClick={() => onAction("idle")}>Stand</button>)}
      </div>
      <p className="hint">WASD / arrows to move (diagonals ok) · Space to attack</p>
      <div className="actions">
        <button onClick={() => onAction("wave")}>Wave</button>
        <button onClick={() => onAction("attack")}>Attack</button>
        <button onClick={() => onAction("hit")}>Take Hit</button>
      </div>
    </div>
  );
}
