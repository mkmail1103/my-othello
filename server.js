import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3000;

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// フロントエンド(dist)の配信
app.use(express.static(path.join(__dirname, 'dist')));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ゲームの状態を保存する場所
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // ■ 修正ポイント1: App.tsxに合わせてイベント名を修正
    socket.on('join_room', ({ roomId, playerName }) => {
        socket.join(roomId);

        // 部屋がなければ作る
        if (!rooms[roomId]) {
            rooms[roomId] = {
                board: Array(8).fill(null).map(() => Array(8).fill(null)),
                turn: 'black',
                players: [],
                status: 'WAITING'
            };
            // 初期配置
            rooms[roomId].board[3][3] = 'white';
            rooms[roomId].board[3][4] = 'black';
            rooms[roomId].board[4][3] = 'black';
            rooms[roomId].board[4][4] = 'white';
        }

        const room = rooms[roomId];

        if (room.players.length < 2) {
            const color = room.players.length === 0 ? 'black' : 'white';
            // プレイヤー情報を保存
            room.players.push({ id: socket.id, name: playerName, color });

            // 1. 本人に「あなたは黒（または白）ですよ」と伝える
            socket.emit('init_game', {
                color,
                roomId
            });

            // 2. 人数に応じて状態を通知する
            if (room.players.length === 1) {
                // 1人目なら「待機中」画面へ
                socket.emit('waiting_opponent');
            } else {
                // 2人目なら「ゲーム開始」画面へ（部屋にいる全員に通知）
                room.status = 'PLAYING';
                io.to(roomId).emit('game_start', {
                    board: room.board,
                    turn: room.turn
                });
            }
        } else {
            socket.emit('error_message', 'Room is full!');
        }
    });

    // ■ 修正ポイント2: イベント名を 'place_stone' から 'make_move' に変更
    // App.tsx は { roomId, row, col } を送ってくる
    socket.on('make_move', ({ roomId, row, col }) => {
        const room = rooms[roomId];

        // 部屋が存在して、ゲーム中なら処理する
        if (room && room.status === 'PLAYING') {
            const color = room.turn; // 現在のターンの色

            // 石を置く（ロジック判定は簡易的に省略し、フロントを信じる）
            room.board[row][col] = color;

            // 挟んだ石を裏返す処理（簡易版：全方向チェック）
            const directions = [
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1], [0, 1],
                [1, -1], [1, 0], [1, 1]
            ];
            const opponent = color === 'black' ? 'white' : 'black';

            for (const [dr, dc] of directions) {
                let r = row + dr;
                let c = col + dc;
                const flips = [];
                // 相手の石が続いている間ループ
                while (r >= 0 && r < 8 && c >= 0 && c < 8 && room.board[r][c] === opponent) {
                    flips.push({ r, c });
                    r += dr;
                    c += dc;
                }
                // 最後に自分の石があれば裏返す
                if (r >= 0 && r < 8 && c >= 0 && c < 8 && room.board[r][c] === color && flips.length > 0) {
                    flips.forEach(p => {
                        room.board[p.r][p.c] = color;
                    });
                }
            }

            // ターン交代
            room.turn = opponent;

            // 全員に新しい盤面を送る
            io.to(roomId).emit('update_board', {
                board: room.board,
                turn: room.turn
            });

            // 勝敗判定などは必要に応じてここに追加
        }
    });

    socket.on('disconnect', () => {
        // 切断時の処理（必要なら実装）
        console.log('User disconnected:', socket.id);
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});