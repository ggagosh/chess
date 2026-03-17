import type { MoveInput } from "./chess-engine";
import { parseUciMove } from "./computer-opponent";

type PendingCommand = {
  kind: "ready" | "search" | "uci";
  match: (line: string) => boolean;
  reject: (error: Error) => void;
  resolve: (line: string) => void;
  timeoutId: number;
};

const ENGINE_READY_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 15_000;
const THINK_TIME_MS = 350;
const STOCKFISH_SCRIPT_URL = "/stockfish/stockfish-18-lite-single.js";
const STOCKFISH_WASM_URL = "/stockfish/stockfish-18-lite-single.wasm";

function splitEngineLines(payload: unknown): string[] {
  return String(payload)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function createWorker(): Worker {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
    throw new Error("This browser cannot run the Stockfish worker.");
  }

  const hash = `${encodeURIComponent(STOCKFISH_WASM_URL)},worker`;

  return new Worker(`${STOCKFISH_SCRIPT_URL}#${hash}`);
}

class StockfishClient {
  private pending: PendingCommand | null = null;
  private readonly readyPromise: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly worker: Worker;

  constructor() {
    this.worker = createWorker();
    this.worker.onmessage = (event) => {
      for (const line of splitEngineLines(event.data)) {
        this.handleLine(line);
      }
    };
    this.worker.onerror = () => {
      this.resetPending(new Error("Stockfish worker execution failed."));
    };
    this.readyPromise = this.initialize();
  }

  async getBestMove(fen: string): Promise<MoveInput> {
    await this.readyPromise;

    return this.enqueue(async () => {
      this.post("ucinewgame");
      this.post(`position fen ${fen}`);
      await this.sendAndWait(
        "isready",
        "ready",
        (line) => line === "readyok",
        ENGINE_READY_TIMEOUT_MS,
      );

      const bestMoveLine = await this.sendAndWait(
        `go movetime ${THINK_TIME_MS}`,
        "search",
        (line) => line.startsWith("bestmove "),
        SEARCH_TIMEOUT_MS,
      );
      const bestMove = bestMoveLine.split(/\s+/)[1];

      return parseUciMove(bestMove);
    });
  }

  cancelSearch() {
    if (!this.pending || this.pending.kind !== "search") {
      return;
    }

    this.post("stop");
    this.resetPending(new Error("Stockfish search was cancelled."));
  }

  dispose() {
    this.cancelSearch();
    this.worker.terminate();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);

    this.queue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }

  private async initialize() {
    await this.sendAndWait("uci", "uci", (line) => line === "uciok", ENGINE_READY_TIMEOUT_MS);
    await this.sendAndWait(
      "isready",
      "ready",
      (line) => line === "readyok",
      ENGINE_READY_TIMEOUT_MS,
    );
  }

  private handleLine(line: string) {
    if (!this.pending || !this.pending.match(line)) {
      return;
    }

    const { resolve, timeoutId } = this.pending;

    window.clearTimeout(timeoutId);
    this.pending = null;
    resolve(line);
  }

  private post(command: string) {
    this.worker.postMessage(command);
  }

  private resetPending(error: Error) {
    if (!this.pending) {
      return;
    }

    const { reject, timeoutId } = this.pending;

    window.clearTimeout(timeoutId);
    this.pending = null;
    reject(error);
  }

  private sendAndWait(
    command: string,
    kind: PendingCommand["kind"],
    match: PendingCommand["match"],
    timeoutMs: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.pending) {
        reject(new Error("Stockfish command queue is busy."));
        return;
      }

      const timeoutId = window.setTimeout(() => {
        this.resetPending(
          new Error(`Timed out while waiting for Stockfish to respond to "${command}".`),
        );
      }, timeoutMs);

      this.pending = {
        kind,
        match,
        reject,
        resolve,
        timeoutId,
      };

      this.post(command);
    });
  }
}

let stockfishClient: StockfishClient | null = null;

function getClient(): StockfishClient {
  if (!stockfishClient) {
    stockfishClient = new StockfishClient();
  }

  return stockfishClient;
}

function resetClient() {
  if (!stockfishClient) {
    return;
  }

  stockfishClient.dispose();
  stockfishClient = null;
}

export async function getStockfishBestMove(fen: string): Promise<MoveInput> {
  const client = getClient();

  try {
    return await client.getBestMove(fen);
  } catch (error) {
    resetClient();
    throw error;
  }
}

export function cancelStockfishSearch() {
  stockfishClient?.cancelSearch();
}
