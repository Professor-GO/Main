import { useRef, useState } from "react";
import { PROFESSORS } from "./data/professors.js";
import Stage from "./stage/Stage.jsx";
import { useInput } from "./stage/useInput.js";
import Controls from "./ui/Controls.jsx";
import Stickman from "./Stickman.jsx";

export default function App() {
  const [idx, setIdx] = useState(0);
  const [facing, setFacing] = useState("front");
  const [status, setStatus] = useState("idle");
  const stage = useRef(null);
  const input = useInput();
  input.onAttack = () => stage.current?.play("attack");

  const professor = PROFESSORS[idx];
  const enemyProfessor = PROFESSORS[(idx + 1) % PROFESSORS.length];
  const pop = () => requestAnimationFrame(() => stage.current?.pop());

  return (
    <div className="app">
      <aside className="panel">
        <h1>Stickman Stage</h1>
        <select value={idx} onChange={(e) => { setIdx(+e.target.value); e.target.blur(); pop(); }}>
          {PROFESSORS.map((p, i) => <option key={p.id} value={i}>{p.name}</option>)}
        </select>
        <button onClick={() => { setFacing(facing === "front" ? "back" : "front"); pop(); }}>
          Standing facing: {facing.toUpperCase()}
        </button>
        <Controls input={input} onAction={(a) => stage.current?.play(a)} />
        <div className="status">Motion: <b>{status.toUpperCase()}</b></div>
        <div className="roster">
          {PROFESSORS.map((p) => <Stickman key={p.id} professor={p} size={52} />)}
        </div>
      </aside>
      <Stage ref={stage} professor={professor} enemyProfessor={enemyProfessor} facing={facing}
             input={input} onFacing={setFacing} onState={setStatus} />
    </div>
  );
}
