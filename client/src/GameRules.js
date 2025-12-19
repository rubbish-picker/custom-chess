import { Chess } from "chess.js";

export const RULESET_IDS = {
  STANDARD: "standard",
  TWO_STEP: "two_step",
};

export const RULESETS = [
  {
    id: RULESET_IDS.STANDARD,
    name: "标准规则",
    description: "普通国际象棋规则",
  },
  {
    id: RULESET_IDS.TWO_STEP,
    name: "每回合两步",
    description: "每人每回合最多走两步；第一步将军则回合结束；被将军时第一步必须解将；任一步产生逼和则立即逼和",
  },
];

const cloneState = (state) => {
  if (!state) return null;
  return JSON.parse(JSON.stringify(state));
};

class BaseChessRules {
  constructor(fen) {
    this.game = new Chess(fen);
    this._snapshots = [];
    this._resetSnapshots();
  }

  getRulesetId() {
    return RULESET_IDS.STANDARD;
  }

  getRulesState() {
    return null;
  }

  setRulesState(_state) {}

  /**
   * 返回"一次悔棋"应该撤回几个半步（ply）。
   * 子类可以覆盖此方法以适配不同规则的悔棋语义。
   * 
   * @returns {number} 撤回的半步数
   */
  getUndoPlies() {
    // 标准规则：悔棋撤回"我方最后一个完整回合"
    // 如果现在轮到我 → 对方已走完 → 撤2步（对方1步+我上一步）
    // 如果现在轮到对方 → 我刚走完 → 撤1步（我刚走的那步）
    const myColor = this.game.turn() === "w" ? "b" : "w"; // 我是谁（当前轮到的对面）
    const nowTurn = this.game.turn();
    return nowTurn === myColor ? 1 : 2;
  }

  /**
   * 按“指定玩家颜色”的语义计算一次悔棋应撤回的半步数。
   *
   * 目标：撤回到“该颜色玩家上一次轮到走子、且回合处于起始状态（turnStep=0）”的局面。
   *
   * - 标准规则下：等价于原 App.jsx 的逻辑（轮到你则撤2步，否则撤1步）
   * - 两步规则下：
   *   - 你走完第一步（turnStep=1）→ 撤1步
   *   - 你走完两步（对方回合）→ 撤2步
   *   - 轮到你但对方刚走完两步 → 可能需要撤3-4步
   */
  getSuggestedUndoPlies(forColor) {
    const color = forColor;
    if (color !== "w" && color !== "b") {
      return this.getUndoPlies();
    }

    const endIndex = this._snapshots.length - 1;
    if (endIndex <= 0) return 1;

    // 从“当前局面之前”开始往回找（避免命中当前就满足条件的局面）
    for (let i = endIndex - 1; i >= 0; i--) {
      const snapshot = this._snapshots[i];
      if (!snapshot?.fen) continue;

      const tempGame = new Chess(snapshot.fen);
      const turnColor = tempGame.turn();
      const stepRaw = Number(snapshot.rulesState?.turnStep);
      const turnStep = stepRaw === 0 || stepRaw === 1 ? stepRaw : 0;

      if (turnColor === color && turnStep === 0) {
        return endIndex - i;
      }
    }

    // 找不到就保守返回 1（由 canUndoPlies 再校验是否真的可撤）
    return 1;
  }

  _resetSnapshots() {
    this._snapshots = [{ fen: this.game.fen(), rulesState: cloneState(this.getRulesState()) }];
  }

  _pushSnapshot() {
    this._snapshots.push({ fen: this.game.fen(), rulesState: cloneState(this.getRulesState()) });
  }

  /**
   * 获取当前棋局的 FEN 字符串 (Forsyth–Edwards Notation)
   */
  getFen() {
    return this.game.fen();
  }

  /**
   * 尝试执行一步移动。
   * @param {object} move - 移动对象 { from: 'e2', to: 'e4', promotion: 'q' }
   * @returns {object|null} - 如果移动合法，返回移动详情；否则返回 null。
   */
  makeMove(move) {
    try {
      const result = this.game.move(move);
      if (!result) return null;
      this._pushSnapshot();
      return result;
    } catch (e) {
      return null;
    }
  }

  /**
   * 远端同步：直接应用对手发来的局面（不依赖 chess.js history），并加入可悔棋快照。
   */
  applyRemoteState(fen, rulesState = null) {
    this.game.load(fen);
    this.setRulesState(rulesState);
    this._pushSnapshot();
  }

  /**
   * 强制同步到某个局面，并重置悔棋历史（用于严重不同步时兜底）。
   */
  syncTo(fen, rulesState = null) {
    this.game.load(fen);
    this.setRulesState(rulesState);
    this._resetSnapshots();
  }

  /**
   * 检查游戏是否结束
   */
  isGameOver() {
    return this.game.isGameOver();
  }

  /**
   * 获取游戏结束的原因
   */
  getGameOverReason() {
    if (this.game.isCheckmate()) return "Checkmate (将死)";
    if (this.game.isDraw()) return "Draw (和棋)";
    if (this.game.isStalemate()) return "Stalemate (逼和)";
    if (this.game.isThreefoldRepetition()) return "Threefold Repetition (三次重复)";
    if (this.game.isInsufficientMaterial()) return "Insufficient Material (子力不足)";
    return "Unknown";
  }

  /**
   * 获取当前回合是谁 (w: 白方, b: 黑方)
   */
  turn() {
    return this.game.turn();
  }

  /**
   * 重置游戏
   */
  reset() {
    this.game.reset();
    this.setRulesState(null);
    this._resetSnapshots();
  }

  /**
   * 加载特定的 FEN（会重置悔棋历史）
   */
  load(fen) {
    this.syncTo(fen, this.getRulesState());
  }

  /**
   * 检查是否将军（chess.js 语义：当前轮到走子的一方是否被将军）
   */
  isInCheck() {
    return this.game.inCheck();
  }

  /**
   * 获取指定位置的棋子
   */
  getPiece(square) {
    return this.game.get(square);
  }

  /**
   * 获取某个位置所有合法的移动目标
   */
  getValidMoves(square) {
    const moves = this.game.moves({ square, verbose: true });
    return moves.map((m) => m.to);
  }

  canUndo() {
    const plies = this.getUndoPlies();
    return this._snapshots.length > plies;
  }

  canUndoPlies(plies) {
    const n = Number(plies) || 0;
    if (n <= 0) return false;
    return this._snapshots.length > n;
  }

  /**
   * 悔棋：撤回"规则定义的合理步数"（调用 getUndoPlies()）
   */
  undo() {
    const plies = this.getUndoPlies();
    return this.undoPlies(plies);
  }

  undoPlies(plies) {
    const n = Math.max(1, Number(plies) || 1);
    if (!this.canUndoPlies(n)) return null;

    for (let i = 0; i < n; i++) {
      this._snapshots.pop();
    }
    const last = this._snapshots[this._snapshots.length - 1];
    this.game.load(last.fen);
    this.setRulesState(last.rulesState);
    return last;
  }

  /**
   * 获取指定颜色的王的位置
   */
  getKingSquare(color) {
    const board = this.game.board();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (piece && piece.type === "k" && piece.color === color) {
          const file = String.fromCharCode(97 + col); // a-h
          const rank = 8 - row; // 1-8
          return file + rank;
        }
      }
    }
    return null;
  }

  isCheckmate() {
    return this.game.isCheckmate();
  }

  isDraw() {
    return this.game.isDraw();
  }
}

export class StandardChessRules extends BaseChessRules {
  getRulesetId() {
    return RULESET_IDS.STANDARD;
  }
}

export class TwoStepChessRules extends BaseChessRules {
  constructor(fen) {
    super(fen);
    this.turnStep = 0; // 0=本回合第1步；1=本回合第2步
    this._resetSnapshots();
  }

  getRulesetId() {
    return RULESET_IDS.TWO_STEP;
  }

  getRulesState() {
    return { turnStep: this.turnStep };
  }

  setRulesState(state) {
    const step = Number(state?.turnStep);
    if (step === 0 || step === 1) {
      this.turnStep = step;
    } else if (state == null) {
      this.turnStep = 0;
    }
  }

  /**
   * 两步规则下不带“本地玩家颜色”的默认悔棋语义：
   * - 若处于本回合第二步（turnStep=1），撤回1步
   * - 否则撤回上一回合（可能1步或2步）
   *
   * 联机悔棋请使用 BaseChessRules.getSuggestedUndoPlies(playerColor) 来计算 1-4 步。
   */
  getUndoPlies() {
    if (this.turnStep === 1) return 1;

    // 上一回合是否是“两步回合”：看上一个快照是否为 turnStep=1
    const endIndex = this._snapshots.length - 1;
    if (endIndex <= 0) return 1;

    const prev = this._snapshots[endIndex - 1];
    const prevStepRaw = Number(prev?.rulesState?.turnStep);
    const prevTurnStep = prevStepRaw === 0 || prevStepRaw === 1 ? prevStepRaw : 0;
    return prevTurnStep === 1 ? 2 : 1;
  }

  /**
   * 尝试执行一步移动。
   * @param {object} move - 移动对象 { from: 'e2', to: 'e4', promotion: 'q' }
   * @returns {object|null} - 如果移动合法，返回移动详情；否则返回 null。
   */
  makeMove(move) {
    try {
      const moverColor = this.game.turn();
      const isFirstStep = this.turnStep === 0;

      const result = this.game.move(move);
      if (!result) return null;

      // chess.js 语义：走完后 turn() 已切到对手；inCheck() 表示对手是否被将军
      const gaveCheckOnThisPly = this.game.inCheck();
      const ended = this.game.isGameOver();

      // 规则：任一步产生逼和/和棋/将死等都立即结束
      if (ended) {
        this.turnStep = 0;
        this._pushSnapshot();
        return result;
      }

      // 规则：第一步将军则回合立即结束
      if (isFirstStep && gaveCheckOnThisPly) {
        this.turnStep = 0;
        this._pushSnapshot();
        return result;
      }

      // 规则：每回合最多两步
      if (isFirstStep) {
        // 允许第二步：把 active color 改回本方（需要 load FEN）
        const fen = this.game.fen();
        const parts = fen.split(" ");
        parts[1] = moverColor;
        const overridden = parts.join(" ");
        this.game.load(overridden);
        this.turnStep = 1;
        this._pushSnapshot();
        return result;
      }

      // 第二步走完：回合结束（保持 chess.js 的自然换边）
      this.turnStep = 0;
      this._pushSnapshot();
      return result;
    } catch (e) {
      return null;
    }
  }
}

export function createRuleset(id, fen) {
  const rulesetId = id || RULESET_IDS.STANDARD;
  if (rulesetId === RULESET_IDS.TWO_STEP) return new TwoStepChessRules(fen);
  return new StandardChessRules(fen);
}

/**
 * GameRules 类封装了所有的游戏逻辑。
 * 如果你想修改游戏规则，请修改这个类。
 * 
 * 目前它基于 chess.js 实现了标准国际象棋规则。
 * 你可以通过继承或修改这个类来实现自定义规则（例如变体象棋）。
 */
// 兼容旧代码：默认导出仍叫 GameRules（标准规则）
export class GameRules extends StandardChessRules {}
