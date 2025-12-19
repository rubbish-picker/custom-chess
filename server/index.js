const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());

// 添加根路由，用于测试连通性
app.get('/', (req, res) => {
  res.send('Chess Server is Running!');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 存储房间信息：记录每个房间的玩家顺序
const rooms = {};
// 存储房间内待处理请求（悔棋/求和）
const pendingOffers = {}; // roomId -> { id, type: 'undo'|'draw', from: socketId, fromColor, plies?: number, baseFen?: string }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  const removeFromRoom = (roomId, reason) => {
    if (!roomId || !rooms[roomId]) return;

    const idx = rooms[roomId].players.indexOf(socket.id);
    if (idx !== -1) {
      rooms[roomId].players.splice(idx, 1);
    }

    // 通知房间内其他玩家：对手离开（用于前端锁局）
    socket.to(roomId).emit('opponent_left', { socketId: socket.id, reason });

    // 如果房间空了，删除房间，否则广播人数
    if (rooms[roomId].players.length === 0) {
      delete pendingOffers[roomId];
      delete rooms[roomId];
      console.log(`Room ${roomId} deleted (empty)`);
    } else {
      const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      io.to(roomId).emit('room_info', { playerCount: roomSize });
    }
  };

  socket.on('join_room', (roomId, ack) => {
    const currentSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    if (currentSize >= 2) {
      console.log(`Room ${roomId} is full. Rejecting ${socket.id}`);
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'ROOM_FULL' });
      }
      socket.emit('join_error', { error: 'ROOM_FULL' });
      return;
    }

    socket.data.roomId = roomId;
    socket.join(roomId);
    if (typeof ack === 'function') {
      ack({ ok: true });
    }
    console.log(`User ${socket.id} joined room: ${roomId}`);
    
    // 初始化房间信息
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [] };
    }
    
    // 记录玩家加入顺序
    if (!rooms[roomId].players.includes(socket.id)) {
      rooms[roomId].players.push(socket.id);
    }
    
    const playerIndex = rooms[roomId].players.indexOf(socket.id);
    const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    
    console.log(`Room ${roomId} now has ${roomSize} players. Player ${socket.id} is index ${playerIndex}`);
    
    // 向加入的玩家发送他的颜色
    socket.emit('player_assignment', {
      color: playerIndex === 0 ? 'w' : 'b',
      playerIndex: playerIndex
    });
    
    // 向房间内所有人广播房间信息
    io.to(roomId).emit('room_info', { playerCount: roomSize });
  });

  socket.on('offer_action', (data, ack) => {
    // data: { roomId, type: 'undo'|'draw', fromColor, plies?, baseFen? }
    const roomId = data?.roomId;
    const type = data?.type;
    const fromColor = data?.fromColor;
    const plies = Number(data?.plies) || 1;
    const baseFen = typeof data?.baseFen === 'string' ? data.baseFen : null;
    if (!roomId || (type !== 'undo' && type !== 'draw')) {
      if (typeof ack === 'function') ack({ ok: false, error: 'BAD_REQUEST' });
      return;
    }

    if (type === 'undo' && !baseFen) {
      if (typeof ack === 'function') ack({ ok: false, error: 'BAD_REQUEST' });
      return;
    }

    const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    if (roomSize < 2) {
      if (typeof ack === 'function') ack({ ok: false, error: 'OPPONENT_NOT_PRESENT' });
      return;
    }

    if (pendingOffers[roomId]) {
      if (typeof ack === 'function') ack({ ok: false, error: 'OFFER_PENDING' });
      return;
    }

    const offerId = `${Date.now()}_${socket.id}`;
    pendingOffers[roomId] = {
      id: offerId,
      type,
      from: socket.id,
      fromColor,
      plies: type === 'undo' ? Math.max(1, Math.min(2, plies)) : undefined,
      baseFen: type === 'undo' ? baseFen : undefined,
    };

    socket.to(roomId).emit('offer_received', {
      offerId,
      type,
      fromColor,
      ...(type === 'undo' ? { plies: pendingOffers[roomId].plies } : {}),
    });

    if (typeof ack === 'function') ack({ ok: true, offerId });
  });

  socket.on('respond_offer', (data, ack) => {
    // data: { roomId, offerId, accept: boolean, currentFen? }
    const roomId = data?.roomId;
    const offerId = data?.offerId;
    const accept = !!data?.accept;
    const pending = pendingOffers[roomId];
    const currentFen = typeof data?.currentFen === 'string' ? data.currentFen : null;

    if (!roomId || !offerId || !pending || pending.id !== offerId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'OFFER_NOT_FOUND' });
      return;
    }

    // 只有非发起人才能响应
    if (pending.from === socket.id) {
      if (typeof ack === 'function') ack({ ok: false, error: 'CANNOT_ACCEPT_OWN' });
      return;
    }

    // 如果对局在请求发出后继续走子，则悔棋请求应视为过期，避免撤回错误的步。
    if (accept && pending.type === 'undo') {
      if (!currentFen || !pending.baseFen || currentFen !== pending.baseFen) {
        delete pendingOffers[roomId];
        io.to(roomId).emit('offer_result', {
          offerId,
          type: pending.type,
          accept: false,
          error: 'OFFER_STALE',
        });
        if (typeof ack === 'function') ack({ ok: false, error: 'OFFER_STALE' });
        return;
      }
    }

    delete pendingOffers[roomId];

    io.to(roomId).emit('offer_result', {
      offerId,
      type: pending.type,
      accept,
    });

    if (accept) {
      if (pending.type === 'undo') {
        io.to(roomId).emit('undo_committed', { offerId, plies: pending.plies || 1 });
      } else if (pending.type === 'draw') {
        io.to(roomId).emit('draw_committed', { offerId });
      }
    }

    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('leave_room', (data) => {
    const roomId = typeof data === 'string' ? data : data?.roomId;
    if (!roomId) return;

    console.log(`User ${socket.id} leaving room: ${roomId}`);
    socket.leave(roomId);
    delete pendingOffers[roomId];
    removeFromRoom(roomId, 'leave_room');
    if (socket.data.roomId === roomId) socket.data.roomId = null;
  });

  socket.on('make_move', (data) => {
    // data: { roomId, move, fen }
    const roomId = data?.roomId;

    // 规则：悔棋请求挂起期间若对局继续走子，则自动视为拒绝悔棋（而不是“过期”）
    const pending = roomId ? pendingOffers[roomId] : null;
    if (pending && pending.type === 'undo') {
      const offerId = pending.id;
      delete pendingOffers[roomId];
      io.to(roomId).emit('offer_result', {
        offerId,
        type: 'undo',
        accept: false,
        error: 'OFFER_REJECTED_BY_MOVE',
      });
    }

    // 广播给房间内的其他人（除了发送者）
    socket.to(roomId).emit('receive_move', data);
  });

  socket.on('reset_game', (roomId) => {
    io.to(roomId).emit('game_reset');
  });
  
  socket.on('resign_game', (data) => {
    // data: { roomId, color }
    // 广播给房间内的所有人
    io.to(data.roomId).emit('player_resigned', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // 清理房间信息（断开也视为离开）
    if (socket.data.roomId) {
      removeFromRoom(socket.data.roomId, 'disconnect');
      socket.data.roomId = null;
      return;
    }

    // 兜底：如果 roomId 没记录，遍历查找
    for (const roomId in rooms) {
      if (rooms[roomId]?.players?.includes(socket.id)) {
        removeFromRoom(roomId, 'disconnect');
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
