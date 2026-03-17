import "./App.css";

const stack = ["React 19 + TypeScript", "Vite 8 + React plugin", "Oxlint + Oxfmt"];

const scripts = [
  {
    command: "npm run dev",
    description: "Start the local development server with HMR.",
  },
  {
    command: "npm run lint",
    description: "Run Oxc linting against the scaffold.",
  },
  {
    command: "npm run format:check",
    description: "Verify the tracked TS/TSX/HTML/JSON files are formatted.",
  },
  {
    command: "npm run build",
    description: "Type-check and produce the production bundle.",
  },
];

const boardSquares = Array.from({ length: 64 }, (_, index) => index);

function App() {
  return (
    <main className="app-shell">
      <section className="intro-panel">
        <p className="eyebrow">Chess App Starter</p>
        <h1>Modern React base, ready for the game layer.</h1>
        <p className="lede">
          Scaffolded from the current Vite React template and aligned with the VitePlus direction
          through Vite, React, and the Oxc linting and formatting toolchain.
        </p>
        <div className="pill-row" aria-label="Project stack">
          {stack.map((item) => (
            <span key={item} className="pill">
              {item}
            </span>
          ))}
        </div>

        <div className="card">
          <h2>Starter scripts</h2>
          <ul className="script-list">
            {scripts.map((script) => (
              <li key={script.command} className="script-item">
                <code>{script.command}</code>
                <span>{script.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="board-panel">
        <div className="board-frame">
          <div className="board-grid" aria-hidden="true">
            {boardSquares.map((square) => {
              const rank = Math.floor(square / 8);
              const file = square % 8;
              const isLightSquare = (rank + file) % 2 === 0;

              return (
                <span key={square} className={isLightSquare ? "square light" : "square dark"} />
              );
            })}
            <span className="piece piece-light">♔</span>
            <span className="piece piece-dark">♛</span>
          </div>
          <p className="board-caption">
            Board UI comes next. The app shell, tooling, and production build pipeline are ready.
          </p>
        </div>
      </section>
    </main>
  );
}

export default App;
