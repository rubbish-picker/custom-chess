import React, { useState, useEffect, useRef } from "react";
import { Chessboard } from "react-chessboard";
import io from "socket.io-client";
import { createRuleset, RULESETS, RULESET_IDS } from "./GameRules";
import "./App.css";

function App() {
  // 游戏逻辑实例
  // 我们使用 ref 来保持 gameRules 实例，但它的内部状态变化不会触发重渲染
  // 所以我们需要一个 state (fen) 来驱动 UI 更新
  const gameRulesRef = useRef(createRuleset(RULESET_IDS.STANDARD));
  const [fen, setFen] = useState(gameRulesRef.current.getFen());

  // 规则选择（仅前端；服务端无需修改，会透传 make_move payload）
  const [rulesetId, setRulesetId] = useState(RULESET_IDS.STANDARD);
  const rulesetIdRef = useRef(RULESET_IDS.STANDARD);
  
  // 连接状态
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverUrl, setServerUrl] = useState("http://localhost:3001");
  const [roomId, setRoomId] = useState("");
  const [isInGame, setIsInGame] = useState(false);
  const [playerCount, setPlayerCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  
  // 新增状态
  const [playerColor, setPlayerColor] = useState(null); // 'w' 或 'b'
  const playerColorRef = useRef(null); // 用于在事件处理中跟踪颜色
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [localGameOver, setLocalGameOver] = useState(null); // { reason: string, winner: 'w'|'b'|null, type: 'resign'|'draw'|'checkmate'|'other' }

  // 升变选择：在落子前弹窗选择 (q/r/b/n)
  const [pendingPromotion, setPendingPromotion] = useState(null); // { from: string, to: string }

  // 悔棋/求和 请求状态
  const [incomingOffer, setIncomingOffer] = useState(null); // { offerId, type: 'undo'|'draw', fromColor }
  const [outgoingOffer, setOutgoingOffer] = useState(null); // { offerId, type: 'undo'|'draw' }
  const incomingOfferRef = useRef(null);
  const outgoingOfferRef = useRef(null);

  // UI: Toast + Confirm Modal（替代 alert/confirm）
  const [toast, setToast] = useState(null); // { message: string, type: 'info'|'success'|'warning'|'error' }
  const toastTimerRef = useRef(null);
  const [confirmDialog, setConfirmDialog] = useState(null); // { title: string, message: string, resolve: (result: boolean) => void }
  
  // 音效
  // 懒加载：避免一进页面就请求 /sounds/*.mp3 导致 404 刷屏
  const moveSound = useRef(null);
  const checkSound = useRef(null);

  const showToast = (message, type = 'info', durationMs = 2400) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  };

  const showConfirm = (title, message) => {
    return new Promise((resolve) => {
      setConfirmDialog({ title, message, resolve });
    });
  };

  const closeConfirm = (result) => {
    if (confirmDialog?.resolve) confirmDialog.resolve(result);
    setConfirmDialog(null);
  };

  const isPromotionAttempt = (from, to) => {
    const piece = gameRulesRef.current.getPiece(from);
    if (!piece || piece.type !== 'p') return false;
    const toRank = Number(String(to).slice(1));
    if (piece.color === 'w') return toRank === 8;
    return toRank === 1;
  };

  const normalizeCastlingTarget = (from, to) => {
    const piece = gameRulesRef.current.getPiece(from);
    if (!piece || piece.type !== 'k') return { from, to };

    // 兼容：react-chessboard 用户可能把王“放到车上”来易位
    const targetPiece = gameRulesRef.current.getPiece(to);
    if (!targetPiece || targetPiece.type !== 'r' || targetPiece.color !== piece.color) {
      return { from, to };
    }

    const fromFile = String(from)[0];
    const toFile = String(to)[0];
    const fromRank = String(from).slice(1);
    const toRank = String(to).slice(1);
    if (fromFile !== 'e' || fromRank !== toRank) return { from, to };

    // e1->h1 => g1；e1->a1 => c1；e8->h8 => g8；e8->a8 => c8
    if (toFile === 'h') return { from, to: `g${fromRank}` };
    if (toFile === 'a') return { from, to: `c${fromRank}` };
    return { from, to };
  };

  const attemptMove = (from, to, promotion = null) => {
    const normalized = normalizeCastlingTarget(from, to);

    // 升变：先弹窗选择
    if (!promotion && isPromotionAttempt(normalized.from, normalized.to)) {
      setPendingPromotion({ from: normalized.from, to: normalized.to });
      return { ok: false, deferred: true };
    }

    const move = gameRulesRef.current.makeMove({
      from: normalized.from,
      to: normalized.to,
      ...(promotion ? { promotion } : {}),
    });
    if (move === null) return { ok: false, deferred: false };
    return { ok: true, move };
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    incomingOfferRef.current = incomingOffer;
  }, [incomingOffer]);

  useEffect(() => {
    outgoingOfferRef.current = outgoingOffer;
  }, [outgoingOffer]);

  useEffect(() => {
    rulesetIdRef.current = rulesetId;
  }, [rulesetId]);

  const switchRuleset = (nextRulesetId, options = {}) => {
    const id = nextRulesetId || RULESET_IDS.STANDARD;
    const next = createRuleset(id);
    gameRulesRef.current = next;

    // 可选：同步到某个局面（比如接收对手 move 时）
    if (options?.fen) {
      next.syncTo(options.fen, options.rulesState || null);
      setFen(next.getFen());
    } else {
      setFen(next.getFen());
    }

    setSelectedSquare(null);
    setValidMoves([]);
    setLocalGameOver(null);
    setPendingPromotion(null);
    setIncomingOffer(null);
    setOutgoingOffer(null);

    setRulesetId(id);
    rulesetIdRef.current = id;
  };

  // 连接服务器
  const connectToServer = () => {
    if (socket) return;
    setErrorMsg("");
    
    // 自动补全 http:// 前缀，防止用户忘记输入
    let url = serverUrl;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = "http://" + url;
    }

    // 关键修复：强制使用 websocket 传输
    // 许多内网穿透工具（如 Sakura Frp）对 HTTP 长轮询支持不佳，导致连接失败
    const newSocket = io(url, {
        transports: ['websocket'],
        reconnectionAttempts: 5, // 限制重连次数
        timeout: 10000 // 超时时间
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to server with ID:", newSocket.id);
      setIsConnected(true);
      setErrorMsg("");
    });

    newSocket.on("disconnect", () => {
      console.log("Disconnected from server");
      setIsConnected(false);
      setSocket(null);
    });

    newSocket.on("connect_error", (err) => {
      console.log("Connection error:", err);
      setIsConnected(false);
      setSocket(null);
      setErrorMsg(`连接失败: ${err.message}`);
      newSocket.disconnect();
    });

    newSocket.on("receive_move", (data) => {
      // 收到对手的移动
      const { fen: newFen, rulesetId: remoteRulesetId, rulesState: remoteRulesState } = data || {};

      // 自动切换到对手使用的规则（无需改服务端）
      if (remoteRulesetId && remoteRulesetId !== rulesetIdRef.current) {
        showToast("已自动切换到房主/对手的规则", "info", 2600);
        switchRuleset(remoteRulesetId, { fen: newFen, rulesState: remoteRulesState });
      } else if (newFen) {
        // 远端同步：直接应用对手发来的局面 + 规则状态，并加入本地悔棋快照
        gameRulesRef.current.applyRemoteState(newFen, remoteRulesState || null);
        setFen(gameRulesRef.current.getFen());
      }

      setSelectedSquare(null);
      setValidMoves([]);
      setPendingPromotion(null);
      
      // 播放音效
      playMoveSound();
    });

    newSocket.on("player_assignment", (data) => {
      console.log("Received player_assignment:", data);
      // 只在第一次设置颜色
      if (!playerColorRef.current) {
        console.log(`Setting player color to ${data.color === 'w' ? 'WHITE' : 'BLACK'}`);
        setPlayerColor(data.color);
        playerColorRef.current = data.color;
      }
    });
    
    newSocket.on("room_info", (data) => {
      console.log("Received room_info:", data);
      setPlayerCount(data.playerCount);
    });

    newSocket.on("join_error", (data) => {
      if (data?.error === 'ROOM_FULL') {
        showToast("房间已满（最多2人）", "warning", 3200);
      } else {
        showToast("加入房间失败", "error", 3200);
      }
      setIsInGame(false);
    });

    newSocket.on("offer_received", (data) => {
      // data: { offerId, type: 'undo'|'draw', fromColor, plies? }
      setIncomingOffer(data);
      if (data?.type === 'undo') {
        showToast("对手请求悔棋", "info", 2400);
      } else if (data?.type === 'draw') {
        showToast("对手请求求和", "info", 2400);
      }
    });

    newSocket.on("offer_result", (data) => {
      // data: { offerId, type, accept, error? }
      const currentOutgoing = outgoingOfferRef.current;
      if (currentOutgoing?.offerId && data.offerId === currentOutgoing.offerId) {
        if (!data.accept) {
          if (data?.error === 'OFFER_REJECTED_BY_MOVE') {
            showToast("对局已继续，悔棋请求已被拒绝", "warning", 3200);
          } else if (data?.error === 'OFFER_STALE') {
            showToast("悔棋请求已过期（对局已继续）", "warning", 3200);
          } else {
            showToast(data.type === 'undo' ? "对手拒绝悔棋" : "对手拒绝求和", "warning", 2800);
          }
        }
        setOutgoingOffer(null);
      }
      const currentIncoming = incomingOfferRef.current;
      if (currentIncoming?.offerId && data.offerId === currentIncoming.offerId) {
        if (!data.accept && data?.error === 'OFFER_REJECTED_BY_MOVE') {
          showToast("你已走子，已自动拒绝对方悔棋", "info", 2800);
        } else if (!data.accept && data?.error === 'OFFER_STALE') {
          showToast("悔棋请求已过期（对局已继续）", "warning", 3200);
        }
        setIncomingOffer(null);
      }
    });

    newSocket.on("undo_committed", (data) => {
      const plies = Math.max(1, Math.min(4, Number(data?.plies) || 1));
      const undone = gameRulesRef.current.undoPlies ? gameRulesRef.current.undoPlies(plies) : null;
      if (undone) {
        setFen(gameRulesRef.current.getFen());
        setSelectedSquare(null);
        setValidMoves([]);
        setPendingPromotion(null);
        showToast(plies > 1 ? `已悔棋（撤回${plies}步）` : "已悔棋", "success");
      } else {
        showToast("无法悔棋（无历史）", "warning");
      }
      setIncomingOffer(null);
      setOutgoingOffer(null);
    });

    newSocket.on("draw_committed", () => {
      setLocalGameOver({ reason: "Draw by agreement (双方同意求和)", winner: null, type: 'draw' });
      setSelectedSquare(null);
      setValidMoves([]);
      setPendingPromotion(null);
      showToast("双方同意求和", "success", 3200);
      setIncomingOffer(null);
      setOutgoingOffer(null);
    });
    
    newSocket.on("game_reset", () => {
        gameRulesRef.current.reset();
        setFen(gameRulesRef.current.getFen());
        setSelectedSquare(null);
        setValidMoves([]);
      setPendingPromotion(null);
      setLocalGameOver(null);
        showToast("游戏已重置", "success");
    });
    
    newSocket.on("player_resigned", (data) => {
        const winnerColor = data.color === 'w' ? 'b' : 'w';
        const winnerName = winnerColor === 'w' ? 'White (白方)' : 'Black (黑方)';
        const loserName = data.color === 'w' ? 'White (白方)' : 'Black (黑方)';
      setLocalGameOver({ reason: "Resign (认输)", winner: winnerColor, type: 'resign' });
      setSelectedSquare(null);
      setValidMoves([]);
      setPendingPromotion(null);
        showToast(`${loserName} 认输，${winnerName} 获胜！`, "warning", 3200);
    });

    newSocket.on("opponent_left", () => {
      // 对手离开：锁定当前对局，禁止 reset 开新局（除非对手回归）
      setLocalGameOver({ reason: "Opponent left (对手已离开)", winner: null, type: 'other' });
      setSelectedSquare(null);
      setValidMoves([]);
      setPendingPromotion(null);
      setIncomingOffer(null);
      setOutgoingOffer(null);
      showToast("对手已离开房间。请返回大厅或等待对手加入。", "warning", 3600);
    });
  };

  // 播放音效
  const playMoveSound = () => {
    try {
      const assetUrl = (relativePath) => {
        // Dev: http://localhost... => 解析为 http://.../sounds/...
        // Packaged(Electron): file:///.../index.html => 解析为 file:///.../sounds/...
        return new URL(relativePath, window.location.href).toString();
      };

      const isCheck = gameRulesRef.current.isInCheck();

      // 需求：将军时不要播放移动音效，只播放将军音效
      if (isCheck) {
        if (!checkSound.current) checkSound.current = new Audio(assetUrl('sounds/check.mp3'));
        checkSound.current.currentTime = 0;
        checkSound.current.play().catch(err => console.log('无法播放将军音效:', err));
        return;
      }

      if (!moveSound.current) moveSound.current = new Audio(assetUrl('sounds/move.mp3'));
      moveSound.current.currentTime = 0;
      moveSound.current.play().catch(err => console.log('无法播放移动音效:', err));
    } catch (err) {
      console.log('播放音效出错:', err);
    }
  };
  
  // 加入房间
  const joinRoom = () => {
    if (!socket || !isConnected) {
        showToast("请先连接服务器", "warning");
        return;
    }
    if (roomId.trim() !== "") {
      const cleanRoomId = roomId.trim();
      socket.emit("join_room", cleanRoomId, (res) => {
        if (res?.ok) {
          // 进入对局前，按当前选择的规则重置本地规则引擎
          switchRuleset(rulesetIdRef.current);
          setRoomId(cleanRoomId);
          setIsInGame(true);
        } else {
          if (res?.error === 'ROOM_FULL') {
            showToast("房间已满（最多2人）", "warning", 3200);
          } else {
            showToast("加入房间失败", "error", 3200);
          }
        }
      });
    } else {
      showToast("请输入有效的房间号", "warning");
    }
  };

  // 处理棋子移动
  function onDrop(sourceSquare, targetSquare) {
    if (localGameOver || gameRulesRef.current.isGameOver()) return false;
    if (pendingPromotion) return false;
    if (playerCount < 2) {
      showToast("等待对手加入后才能开始", "info");
      return false;
    }
    // 检查是否轮到己方
    const currentTurn = gameRulesRef.current.turn();
    if (!playerColor || currentTurn !== playerColor) {
      return false; // 不是己方回合
    }

    // 只能移动己方棋子
    const sourcePiece = gameRulesRef.current.getPiece(sourceSquare);
    if (!sourcePiece || sourcePiece.color !== playerColor) {
      return false;
    }

    // 若对手有悔棋请求挂起：你选择继续走子 => 视为拒绝悔棋
    if (incomingOffer?.type === 'undo') {
      setIncomingOffer(null);
      showToast("已走子，已拒绝对方悔棋请求", "info", 2200);
    }
    
    // 尝试在本地执行移动（含：易位兼容 + 升变选择）
    const res = attemptMove(sourceSquare, targetSquare);

    // 如果移动非法，返回 false，棋盘会自动回弹
    if (!res.ok) return false;

    // 更新 UI
    setFen(gameRulesRef.current.getFen());
    
    // 清除选中状态
    setSelectedSquare(null);
    setValidMoves([]);
    
    // 播放音效
    playMoveSound();

    // 发送移动给服务器
    if (socket && isInGame) {
      socket.emit("make_move", {
        roomId,
        move: res.move,
        fen: gameRulesRef.current.getFen(),
        rulesetId: rulesetIdRef.current,
        rulesState: gameRulesRef.current.getRulesState ? gameRulesRef.current.getRulesState() : null,
      });
    }
    
    return true;
  }
  
  const resetGame = () => {
      if (!gameRulesRef.current.isGameOver() && !localGameOver) {
        showToast("游戏还未结束，不能重置！请先完成当前对局或认输。", "warning", 3200);
        return;
      }
      if (playerCount < 2) {
        showToast("对手不在房间内，不能开始新对局。请返回大厅或等待对手加入。", "warning", 3600);
        return;
      }
      gameRulesRef.current.reset();
      setFen(gameRulesRef.current.getFen());
      setSelectedSquare(null);
      setValidMoves([]);
      setLocalGameOver(null);
        setPendingPromotion(null);
      if (socket && isInGame) {
          socket.emit("reset_game", roomId);
      }
  };

  const backToRoomEntry = () => {
    // 返回“填写房间号”界面，并清理本局状态，方便开始新对局
    if (socket && isInGame && roomId) {
      socket.emit('leave_room', { roomId });
    }
    gameRulesRef.current.reset();
    setFen(gameRulesRef.current.getFen());
    setSelectedSquare(null);
    setValidMoves([]);
    setLocalGameOver(null);
    setPendingPromotion(null);
    setRoomId("");
    setPlayerCount(0);
    setPlayerColor(null);
    playerColorRef.current = null;
    setIsInGame(false);
    showToast("已返回房间选择", "info");
  };

  const resignGame = async () => {
    if (!playerColor) {
      showToast("尚未分配到玩家颜色，无法认输。", "warning");
      return;
    }
    if (localGameOver || gameRulesRef.current.isGameOver()) {
      showToast("游戏已经结束了！", "info");
      return;
    }
    const confirmed = await showConfirm("确认认输", "确定要认输吗？");
    if (!confirmed) return;

    const winnerColor = playerColor === 'w' ? 'b' : 'w';
    setLocalGameOver({ reason: "Resign (认输)", winner: winnerColor, type: 'resign' });
    setSelectedSquare(null);
    setValidMoves([]);
    setPendingPromotion(null);

    if (socket && isInGame) {
      socket.emit("resign_game", { roomId, color: playerColor });
    }
  };

  const requestUndo = () => {
    if (!socket || !isInGame || !roomId) return;
    if (playerCount < 2) {
      showToast("对手不在房间内，无法请求", "warning");
      return;
    }
    if (localGameOver || gameRulesRef.current.isGameOver()) {
      showToast("对局已结束", "info");
      return;
    }

    // 按当前规则与玩家颜色计算本次悔棋需要撤回的半步数（两步规则可能为 1-4）
    const pliesRaw = gameRulesRef.current.getSuggestedUndoPlies
      ? gameRulesRef.current.getSuggestedUndoPlies(playerColor)
      : ((playerColor && gameRulesRef.current.turn() === playerColor) ? 2 : 1);
    const plies = Math.max(1, Math.min(4, Number(pliesRaw) || 1));
    if (!gameRulesRef.current.canUndoPlies(plies)) {
      showToast("当前无可悔棋的步数", "info");
      return;
    }
    if (incomingOffer || outgoingOffer) {
      showToast("已有待处理请求", "info");
      return;
    }
    const baseFen = gameRulesRef.current.getFen();
    socket.emit('offer_action', { roomId, type: 'undo', fromColor: playerColor, plies, baseFen }, (res) => {
      if (res?.ok) {
        setOutgoingOffer({ offerId: res.offerId, type: 'undo' });
        showToast(plies > 1 ? `已发送悔棋请求（撤回${plies}步）` : "已发送悔棋请求", "info");
      } else if (res?.error === 'OPPONENT_NOT_PRESENT') {
        showToast("对手不在房间内，无法请求", "warning");
      } else if (res?.error === 'OFFER_PENDING') {
        showToast("已有待处理请求", "info");
      } else {
        showToast("发送悔棋请求失败", "error");
      }
    });
  };

  const requestDraw = () => {
    if (!socket || !isInGame || !roomId) return;
    if (playerCount < 2) {
      showToast("对手不在房间内，无法请求", "warning");
      return;
    }
    if (localGameOver || gameRulesRef.current.isGameOver()) {
      showToast("对局已结束", "info");
      return;
    }
    if (incomingOffer || outgoingOffer) {
      showToast("已有待处理请求", "info");
      return;
    }
    socket.emit('offer_action', { roomId, type: 'draw', fromColor: playerColor }, (res) => {
      if (res?.ok) {
        setOutgoingOffer({ offerId: res.offerId, type: 'draw' });
        showToast("已发送求和请求", "info");
      } else if (res?.error === 'OPPONENT_NOT_PRESENT') {
        showToast("对手不在房间内，无法请求", "warning");
      } else if (res?.error === 'OFFER_PENDING') {
        showToast("已有待处理请求", "info");
      } else {
        showToast("发送求和请求失败", "error");
      }
    });
  };

  const respondOffer = (accept) => {
    if (!socket || !incomingOffer || !roomId) return;
    const currentFen = gameRulesRef.current.getFen();
    socket.emit('respond_offer', { roomId, offerId: incomingOffer.offerId, accept, currentFen }, (res) => {
      if (res?.ok) {
        const offerType = incomingOffer.type;
        setIncomingOffer(null);
        if (!accept) {
          showToast(offerType === 'undo' ? '已拒绝悔棋' : '已拒绝求和', 'info');
        }
      } else {
        if (res?.error === 'OFFER_STALE') {
          showToast("悔棋请求已过期（对局已继续）", "warning", 3200);
          setIncomingOffer(null);
        } else if (res?.error === 'OFFER_NOT_FOUND') {
          showToast("请求已失效", "info", 2400);
          setIncomingOffer(null);
        } else {
          showToast("操作失败", "error");
        }
      }
    });
  };
  
  // 处理点击棋子
  const onSquareClick = (square) => {
    if (localGameOver || gameRulesRef.current.isGameOver()) return;
    if (pendingPromotion) return;
    const currentTurn = gameRulesRef.current.turn();
    const canPlayNow = playerColor && currentTurn === playerColor && playerCount >= 2;
    
    // 如果已经选中了棋子，尝试移动到点击的位置
    if (selectedSquare) {
      // 检查是否点击的是有效移动位置
      if (canPlayNow && validMoves.includes(square)) {
        // 若对手有悔棋请求挂起：你选择继续走子 => 视为拒绝悔棋
        if (incomingOffer?.type === 'undo') {
          setIncomingOffer(null);
          showToast("已走子，已拒绝对方悔棋请求", "info", 2200);
        }
        // 执行移动（含：易位兼容 + 升变选择）
        const res = attemptMove(selectedSquare, square);
        
        if (res.ok) {
          // 更新 UI
          setFen(gameRulesRef.current.getFen());
          setSelectedSquare(null);
          setValidMoves([]);
          
          // 播放音效
          playMoveSound();
          
          // 发送移动给服务器
          if (socket && isInGame) {
            socket.emit("make_move", {
              roomId,
              move: res.move,
              fen: gameRulesRef.current.getFen(),
              rulesetId: rulesetIdRef.current,
              rulesState: gameRulesRef.current.getRulesState ? gameRulesRef.current.getRulesState() : null,
            });
          }
          return;
        }
      }
      
      // 如果点击的不是有效位置，检查是否点击了另一个己方棋子
      const piece = gameRulesRef.current.getPiece(square);
      // 兼容：点击王后，再点自家车进行易位（若 g/c 目标本来就是合法步）
      if (canPlayNow && selectedSquare) {
        const selectedPiece = gameRulesRef.current.getPiece(selectedSquare);
        if (selectedPiece?.type === 'k' && piece?.type === 'r' && piece.color === selectedPiece.color) {
          const normalized = normalizeCastlingTarget(selectedSquare, square);
          if (normalized.to !== square && validMoves.includes(normalized.to)) {
            const res = attemptMove(selectedSquare, normalized.to);
            if (res.ok) {
              setFen(gameRulesRef.current.getFen());
              setSelectedSquare(null);
              setValidMoves([]);
              playMoveSound();
              if (socket && isInGame) {
                socket.emit("make_move", {
                  roomId,
                  move: res.move,
                  fen: gameRulesRef.current.getFen(),
                  rulesetId: rulesetIdRef.current,
                  rulesState: gameRulesRef.current.getRulesState ? gameRulesRef.current.getRulesState() : null,
                });
              }
              return;
            }
          }
        }
      }
      if (piece && playerColor && piece.color === playerColor) {
        // 切换选中的棋子
        setSelectedSquare(square);
        if (canPlayNow) {
          const moves = gameRulesRef.current.getValidMoves(square);
          setValidMoves(moves);
        } else {
          // 不在自己回合也允许高亮选中，但不显示可走点
          setValidMoves([]);
        }
      } else {
        // 清除选中
        setSelectedSquare(null);
        setValidMoves([]);
      }
    } else {
      // 没有选中棋子，尝试选中
      const piece = gameRulesRef.current.getPiece(square);
      if (piece && playerColor && piece.color === playerColor) {
        setSelectedSquare(square);
        if (canPlayNow) {
          const moves = gameRulesRef.current.getValidMoves(square);
          setValidMoves(moves);
        } else {
          setValidMoves([]);
        }
      } else {
        setSelectedSquare(null);
        setValidMoves([]);
      }
    }
  };
  
  // 自定义方块样式
  const customSquareStyles = {};
  const effectiveGameOver = !!localGameOver || gameRulesRef.current.isGameOver();
  
  // 高亮被将军的王
  if (!effectiveGameOver && gameRulesRef.current.isInCheck()) {
    const kingSquare = gameRulesRef.current.getKingSquare(gameRulesRef.current.turn());
    if (kingSquare) {
      customSquareStyles[kingSquare] = {
        backgroundColor: 'rgba(255, 0, 0, 0.6)',
        boxShadow: '0 0 20px rgba(255, 0, 0, 0.8) inset'
      };
    }
  }
  
  // 高亮选中的棋子（如果不是被将军的王，避免覆盖）
  if (selectedSquare) {
    const isKingInCheck = gameRulesRef.current.isInCheck() && 
                          selectedSquare === gameRulesRef.current.getKingSquare(gameRulesRef.current.turn());
    if (!isKingInCheck) {
      customSquareStyles[selectedSquare] = {
        backgroundColor: 'rgba(255, 255, 0, 0.5)',
        boxShadow: '0 0 15px rgba(255, 255, 0, 0.7) inset'
      };
    } else {
      // 如果是被将军的王，使用混合色
      customSquareStyles[selectedSquare] = {
        backgroundColor: 'rgba(255, 128, 0, 0.6)',
        boxShadow: '0 0 20px rgba(255, 128, 0, 0.8) inset'
      };
    }
  }
  
  // 高亮可落子位置
  validMoves.forEach(square => {
    const targetPiece = gameRulesRef.current.getPiece(square);
    if (targetPiece) {
      // 可以吃子的位置显示为圆环
      customSquareStyles[square] = {
        background: 'radial-gradient(circle, transparent 65%, rgba(0,0,0,.3) 65%, rgba(0,0,0,.3) 80%, transparent 80%)',
      };
    } else {
      // 空位显示为圆点
      customSquareStyles[square] = {
        background: 'radial-gradient(circle, rgba(0,0,0,.15) 25%, transparent 25%)',
        borderRadius: '50%'
      };
    }
  });

  return (
    <div className="game-container">
      <h1>Custom Chess</h1>

      {toast && (
        <div className={`toast toast--${toast.type}`} role="status" aria-live="polite">
          <span className="toast__message">{toast.message}</span>
          <button className="toast__close" onClick={() => setToast(null)} aria-label="Close">
            ×
          </button>
        </div>
      )}

      {confirmDialog && (
        <div className="confirm" role="dialog" aria-modal="false" aria-label={confirmDialog.title}>
          <div className="confirm__title">{confirmDialog.title}</div>
          <div className="confirm__message">{confirmDialog.message}</div>
          <div className="confirm__actions">
            <button className="btn btn--ghost" onClick={() => closeConfirm(false)}>
              取消
            </button>
            <button className="btn btn--danger" onClick={() => closeConfirm(true)}>
              确定
            </button>
          </div>
        </div>
      )}

      {pendingPromotion && (
        <div className="confirm" role="dialog" aria-modal="false" aria-label="选择升变棋子">
          <div className="confirm__title">选择升变棋子</div>
          <div className="confirm__message">
            请选择升变为：
          </div>
          <div className="confirm__actions">
            <button
              className="btn btn--ghost"
              onClick={() => {
                setPendingPromotion(null);
                showToast("已取消升变移动", "info", 2200);
              }}
            >
              取消
            </button>
            {([
              { key: 'q', label: '后 (Q)' },
              { key: 'r', label: '车 (R)' },
              { key: 'b', label: '象 (B)' },
              { key: 'n', label: '马 (N)' },
            ]).map((p) => (
              <button
                key={p.key}
                className="btn btn--primary"
                onClick={() => {
                  const from = pendingPromotion.from;
                  const to = pendingPromotion.to;
                  setPendingPromotion(null);
                  const res = attemptMove(from, to, p.key);
                  if (!res.ok) {
                    showToast("升变移动失败（可能不合法）", "warning", 2600);
                    return;
                  }

                  setFen(gameRulesRef.current.getFen());
                  setSelectedSquare(null);
                  setValidMoves([]);
                  playMoveSound();

                  if (socket && isInGame) {
                    socket.emit("make_move", {
                      roomId,
                      move: res.move,
                      fen: gameRulesRef.current.getFen(),
                      rulesetId: rulesetIdRef.current,
                      rulesState: gameRulesRef.current.getRulesState ? gameRulesRef.current.getRulesState() : null,
                    });
                  }
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {!isInGame ? (
        <div className="card">
          <div style={{marginBottom: '10px'}}>
            <label>Server URL: </label>
            <input 
              value={serverUrl} 
              onChange={(e) => setServerUrl(e.target.value)} 
              placeholder="http://localhost:3001"
            />
            <button onClick={connectToServer} disabled={isConnected || !!socket}>
              {isConnected ? "Connected" : (socket ? "Connecting..." : "Connect")}
            </button>
          </div>
          
          {errorMsg && <div style={{color: 'red', marginBottom: '10px'}}>{errorMsg}</div>}

          {isConnected && (
            <div>
              <div style={{marginBottom: '10px'}}>
                <label style={{marginRight: '10px'}}>Rules (规则):</label>
                <select
                  value={rulesetId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setRulesetId(nextId);
                    switchRuleset(nextId);
                  }}
                  style={{ padding: '10px', fontSize: '16px' }}
                >
                  {RULESETS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <div style={{ marginTop: '6px', fontSize: '12px', color: 'rgba(0,0,0,0.65)' }}>
                  {RULESETS.find((r) => r.id === rulesetId)?.description}
                </div>
              </div>

              <label>Room ID: </label>
              <input 
                value={roomId} 
                onChange={(e) => setRoomId(e.target.value)} 
                placeholder="Enter Room ID"
              />
              <button onClick={joinRoom}>Join Game</button>
            </div>
          )}
        </div>
      ) : (
        <div className="gameLayout">
          <div className="boardColumn">
            <div className="gameHeader">
              <div>
                <div style={{marginBottom: '5px'}}>Room: <strong>{roomId}</strong></div>
                <div>Players: <strong>{playerCount}</strong> {playerCount < 2 && <span style={{color: 'orange'}}>(Waiting for opponent...)</span>}</div>
                <div style={{marginTop: '5px'}}>
                  Rules: <strong>{RULESETS.find((r) => r.id === rulesetId)?.name || rulesetId}</strong>
                </div>
                {playerColor && (
                  <div style={{marginTop: '5px'}}>You are: <strong>{playerColor === 'w' ? 'White (白方)' : 'Black (黑方)'}</strong></div>
                )}
                {!effectiveGameOver ? (
                  <div style={{marginTop: '5px', fontSize: '18px', fontWeight: 'bold'}}>
                    Current Turn: <span style={{color: gameRulesRef.current.turn() === 'w' ? '#333' : '#111'}}>
                      {gameRulesRef.current.turn() === 'w' ? 'White (白方)' : 'Black (黑方)'}
                    </span>
                    {playerColor && gameRulesRef.current.turn() === playerColor && (
                      <span style={{color: 'green', marginLeft: '10px'}}>← Your Turn!</span>
                    )}
                    {/* {gameRulesRef.current.isInCheck() && (
                      <span style={{color: 'red', marginLeft: '10px'}}>⚠️ CHECK!</span>
                    )} */}
                  </div>
                ) : (
                  <div style={{marginTop: '5px', fontSize: '20px', fontWeight: 'bold', color: '#d32f2f'}}>
                    Game Over!
                  </div>
                )}
              </div>
            </div>

            <div className="boardArea">
              <Chessboard 
                position={fen} 
                onPieceDrop={onDrop}
                onSquareClick={onSquareClick}
                boardOrientation={playerColor === 'b' ? 'black' : 'white'}
                customSquareStyles={customSquareStyles}
              />
            </div>
          </div>

          <div className="sidePanel">
            {incomingOffer && (
              <div className="offerBar" role="status" aria-live="polite">
                <div className="offerBar__text">
                  {incomingOffer.type === 'undo'
                    ? `对手请求悔棋${incomingOffer.plies === 2 ? '' : ''}`
                    : '对手请求求和'}
                </div>
                <div className="offerBar__actions">
                  <button className="btn btn--ghost" onClick={() => respondOffer(false)}>
                    拒绝
                  </button>
                  <button className="btn btn--primary" onClick={() => respondOffer(true)}>
                    同意
                  </button>
                </div>
              </div>
            )}

            <div className="actionsPanel" role="group" aria-label="Game actions">
              <button
                className="btn btn--ghost"
                onClick={requestUndo}
                disabled={effectiveGameOver || playerCount < 2 || !!incomingOffer || !!outgoingOffer}
              >
                悔棋
              </button>
              <button
                className="btn btn--ghost"
                onClick={requestDraw}
                disabled={effectiveGameOver || playerCount < 2 || !!incomingOffer || !!outgoingOffer}
              >
                求和
              </button>
              <button
                className="btn btn--danger"
                onClick={resignGame}
                disabled={effectiveGameOver}
              >
                认输
              </button>
              <button
                className="btn btn--primary"
                onClick={backToRoomEntry}
                disabled={!effectiveGameOver}
              >
                返回大厅
              </button>
              <button
                className="btn btn--primary"
                onClick={resetGame}
                disabled={!effectiveGameOver || playerCount < 2}
              >
                重置
              </button>

              {outgoingOffer && (
                <div className="hintText" role="status" aria-live="polite">
                  已发送{outgoingOffer.type === 'undo' ? '悔棋' : '求和'}请求，等待对方回应…
                </div>
              )}
            </div>
          
          {effectiveGameOver && (
            <div className="card" style={{marginTop: '20px', backgroundColor: '#fff3cd', border: '2px solid #ffc107'}}>
              <h2 style={{color: '#856404', marginBottom: '10px'}}>Game Over</h2>
              <p style={{fontSize: '18px', fontWeight: 'bold', marginBottom: '10px'}}>
                {localGameOver ? localGameOver.reason : gameRulesRef.current.getGameOverReason()}
              </p>
              {!localGameOver && gameRulesRef.current.isCheckmate() && (
                <p style={{fontSize: '20px', color: '#d32f2f', fontWeight: 'bold'}}>
                  Winner: {gameRulesRef.current.turn() === 'w' ? 'Black (黑方)' : 'White (白方)'} 
                </p>
              )}
              {!localGameOver && gameRulesRef.current.isDraw() && (
                <p style={{fontSize: '20px', color: '#1976d2', fontWeight: 'bold'}}>
                  Result: Draw (平局) 🤝
                </p>
              )}
              {localGameOver?.winner && (
                <p style={{fontSize: '20px', color: '#d32f2f', fontWeight: 'bold'}}>
                  Winner: {localGameOver.winner === 'w' ? 'White (白方)' : 'Black (黑方)'} 
                </p>
              )}
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
