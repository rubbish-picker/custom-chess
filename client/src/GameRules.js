import { Chess } from "chess.js";

/**
 * GameRules 类封装了所有的游戏逻辑。
 * 如果你想修改游戏规则，请修改这个类。
 * 
 * 目前它基于 chess.js 实现了标准国际象棋规则。
 * 你可以通过继承或修改这个类来实现自定义规则（例如变体象棋）。
 */
export class GameRules {
  constructor(fen) {
    // 初始化 chess.js 实例
    this.game = new Chess(fen);
  }

  /**
   * 获取当前棋局的 FEN 字符串 (Forsyth–Edwards Notation)
   * FEN 是描述棋局状态的标准格式。
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
      // 在这里你可以添加自定义的移动验证逻辑
      // 例如：禁止某个棋子移动，或者改变移动规则
      
      // 使用 chess.js 的验证和执行
      const result = this.game.move(move);
      return result;
    } catch (e) {
      return null;
    }
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
  }
  
  /**
   * 加载特定的 FEN
   */
  load(fen) {
    this.game.load(fen);
  }
  
  /**
   * 检查是否将军
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
    return moves.map(move => move.to);
  }

  canUndo() {
    return this.game.history().length > 0;
  }

  canUndoPlies(plies) {
    const n = Number(plies) || 0;
    if (n <= 0) return false;
    return this.game.history().length >= n;
  }

  undo() {
    try {
      const result = this.game.undo();
      return result;
    } catch (e) {
      return null;
    }
  }
  
  /**
   * 获取指定颜色的王的位置
   */
  getKingSquare(color) {
    const board = this.game.board();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (piece && piece.type === 'k' && piece.color === color) {
          // 将行列转换为方格标记（如 'e1'）
          const file = String.fromCharCode(97 + col); // a-h
          const rank = 8 - row; // 1-8
          return file + rank;
        }
      }
    }
    return null;
  }
  
  /**
   * 检查是否将死
   */
  isCheckmate() {
    return this.game.isCheckmate();
  }
  
  /**
   * 检查是否和棋
   */
  isDraw() {
    return this.game.isDraw();
  }
}
