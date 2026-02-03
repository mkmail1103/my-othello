import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// ESモジュールでフォルダパスを取得するおまじない
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// ネット公開時は環境変数のPORTを使い、なければ3000を使う
const PORT = process.env.PORT || 3000;

// Socket.ioの設定
const io = new Server(httpServer, {
    cors: {
        // どんなURLからでも接続OKにする（厳密な制限を外す）
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- ここが追加ポイント ---
// "dist" フォルダ（ビルドされた画面データ）を公開する
app.use(express.static(path.join(__dirname, 'dist')));

// どのURLにアクセスされても、オセロの画面(index.html)を返す
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});
// ------------------------

// オセロのロジック（ここは前のままでOKですが、コピペ用に全部載せます）
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', ({ roomId, playerName }) => {
        socket.join(roomId);

        // 部屋がないなら作る
        if (!rooms[roomId]) {
            rooms[roomId] = {
                board: Array(8).fill(null).map(() => Array(8).fill(null)),
                turn: 'black', // 最初は黒
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

        // プレイヤー追加
        // 既に2人いたら入れない処理などは省略（簡易版）
        if (room.players.length < 2) {
            const color = room.players.length === 0 ? 'black' : 'white';
            room.players.push({ id: socket.id, name: playerName, color });

            // 本人に色を伝える
            socket.emit('init_game', {
                color,
                board: room.board,
                turn: room.turn
            });

            // 全員に「誰か入ったよ」と伝える
            io.to(roomId).emit('update_status', {
                players: room.players,
                status: room.players.length === 2 ? 'PLAYING' : 'WAITING'
            });
        } else {
            // 満員の場合（観戦者として扱うならここを変える）
            socket.emit('room_full');
        }
    });

    socket.on('place_stone', ({ roomId, row, col, color }) => {
        const room = rooms[roomId];
        if (room && room.turn === color) {
            // 本当はここで「置けるか判定」をするべきだが、
            // フロントエンドで判定しているので一旦信じて反映する
            room.board[row][col] = color;
            // ターン交代
            room.turn = color === 'black' ? 'white' : 'black';

            // 全員に新しい盤面を送る
            io.to(roomId).emit('update_board', {
                board: room.board,
                turn: room.turn
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        // 部屋から人が消えた処理などはここで
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});