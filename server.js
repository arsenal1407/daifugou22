const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const game = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; // code -> room
const socketRoom = {}; // socket.id -> room code

function broadcast(code) {
  const room = rooms[code];
  if (!room) return;
  room.players.forEach((p) => {
    const sock = io.sockets.sockets.get(p.id);
    if (sock) {
      sock.emit('state', game.serializeForPlayer(room, p.id));
    }
  });
}

io.on('connection', (socket) => {
  socket.on('createOrJoin', ({ name, passphrase }) => {
    const code = String(passphrase || '').trim();
    const trimmedName = String(name || '').trim().slice(0, 20);
    if (!code || !trimmedName) {
      socket.emit('error', { message: '名前と合言葉を入力してください' });
      return;
    }
    let room = rooms[code];
    if (!room) {
      room = game.makeRoom(code);
      rooms[code] = room;
    }
    if (room.started) {
      socket.emit('error', { message: 'このルームは既に対戦中です' });
      return;
    }
    if (room.players.length >= 10) {
      socket.emit('error', { message: 'ルームが満員です(最大10人)' });
      return;
    }
    game.addPlayer(room, socket.id, trimmedName);
    socketRoom[socket.id] = code;
    socket.join(code);
    broadcast(code);
  });

  socket.on('updateRules', (rules) => {
    const code = socketRoom[socket.id];
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', { message: 'ホストのみルールを変更できます' });
      return;
    }
    if (room.started) return;
    Object.keys(game.DEFAULT_RULES).forEach((key) => {
      if (typeof rules[key] === 'boolean') room.rules[key] = rules[key];
    });
    broadcast(code);
  });

  socket.on('startGame', () => {
    const code = socketRoom[socket.id];
    const room = rooms[code];
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', { message: 'ホストのみ開始できます' });
      return;
    }
    if (room.players.length < 2) {
      socket.emit('error', { message: '2人以上必要です' });
      return;
    }
    if (room.players.length > 10) {
      socket.emit('error', { message: '最大10人までです' });
      return;
    }
    game.startGame(room);
    broadcast(code);
  });

  socket.on('startNextRound', () => {
    const code = socketRoom[socket.id];
    const room = rooms[code];
    if (!room) return;
    const res = game.startNextRound(room, socket.id);
    if (res.error) {
      socket.emit('error', { message: res.error });
      return;
    }
    broadcast(code);
  });

  socket.on('playCards', ({ cardIds }) => {
    const code = socketRoom[socket.id];
    const room = rooms[code];
    if (!room) return;
    const res = game.play(room, socket.id, cardIds || []);
    if (res.error) {
      socket.emit('error', { message: res.error });
      return;
    }
    broadcast(code);
  });

  socket.on('pass', () => {
    const code = socketRoom[socket.id];
    const room = rooms[code];
    if (!room) return;
    const res = game.pass(room, socket.id);
    if (res.error) {
      socket.emit('error', { message: res.error });
      return;
    }
    broadcast(code);
  });

  socket.on('giveCards', ({ targetPlayerId, cardIds }) => {
    const code = socketRoom[socket.id];
    const room = rooms[code];
    if (!room) return;
    const res = game.giveCards(room, socket.id, targetPlayerId, cardIds || []);
    if (res.error) {
      socket.emit('error', { message: res.error });
      return;
    }
    broadcast(code);
  });

  socket.on('discardCards', ({ cardIds }) => {
    const code = socketRoom[socket.id];
    const room = rooms[code];
    if (!room) return;
    const res = game.discardCards(room, socket.id, cardIds || []);
    if (res.error) {
      socket.emit('error', { message: res.error });
      return;
    }
    broadcast(code);
  });

  socket.on('exchangeReturn', ({ cardIds }) => {
    const code = socketRoom[socket.id];
    const room = rooms[code];
    if (!room) return;
    const res = game.exchangeReturn(room, socket.id, cardIds || []);
    if (res.error) {
      socket.emit('error', { message: res.error });
      return;
    }
    broadcast(code);
  });

  socket.on('disconnect', () => {
    const code = socketRoom[socket.id];
    if (!code) return;
    const room = rooms[code];
    if (room) {
      game.removePlayer(room, socket.id);
      if (room.players.length === 0) {
        delete rooms[code];
      } else {
        broadcast(code);
      }
    }
    delete socketRoom[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`大富豪オンライン サーバー起動: http://localhost:${PORT}`);
});
