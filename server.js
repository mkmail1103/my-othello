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

app.use(express.static(path.join(__dirname, 'dist')));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const rooms = {};

// --- Helper Functions ---

// 指定した色が置ける場所があるかチェックする関数
function hasValidMoves(board, color) {
    const directions = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1]
    ];
    const opponent = color === 'black' ? 'white' : 'black';

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] !== null) continue;

            for (const [dr, dc] of directions) {
                let nr = r + dr;
                let nc = c + dc;
                let foundOpponent = false;

                while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === opponent) {
                    foundOpponent = true;
                    nr += dr;
                    nc += dc;
                }

                if (foundOpponent && nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === color) {
                    return true; // 少なくとも1箇所置ける場所がある
                }
            }
        }
    }
    return false;
}

// 石の数を数える関数
function countScore(board) {
    let black = 0;
    let white = 0;
    board.forEach(row => row.forEach(cell => {
        if (cell === 'black') black++;
        if (cell === 'white') white++;
    }));
    return { black, white };
}

// --- Socket Logic ---

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // プレイヤーがどの部屋にいるか追跡用
    socket.currentRoom = null;

    socket.on('join_room', ({ roomId, playerName }) => {
        // 以前の部屋があれば抜ける処理を入れる（念のため）
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
        }

        socket.join(roomId);
        socket.currentRoom = roomId;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                board: Array(8).fill(null).map(() => Array(8).fill(null)),
                turn: 'black',
                players: [],
                status: 'WAITING'
            };
            rooms[roomId].board[3][3] = 'white';
            rooms[roomId].board[3][4] = 'black';
            rooms[roomId].board[4][3] = 'black';
            rooms[roomId].board[4][4] = 'white';
        }

        const room = rooms[roomId];

        // 部屋が満員かチェック
        if (room.players.length >= 2) {
            // 再接続しようとした人が、元のプレイヤーかどうかの判定は複雑なので
            // ここでは単純に「満員です」と返します
            socket.emit('error_message', 'Room is full!');
            return;
        }

        const color = room.players.length === 0 ? 'black' : 'white';
        room.players.push({ id: socket.id, name: playerName, color });

        socket.emit('init_game', { color, roomId });

        if (room.players.length === 1) {
            socket.emit('waiting_opponent');
        } else {
            room.status = 'PLAYING';
            io.to(roomId).emit('game_start', {
                board: room.board,
                turn: room.turn
            });
        }
    });

    socket.on('make_move', ({ roomId, row, col }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'PLAYING') return;

        const color = room.turn;

        // 念のためサーバー側でもそこが空いているかチェック
        if (room.board[row][col] !== null) return;

        // 石を置く処理
        room.board[row][col] = color;

        // ひっくり返す処理
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
            while (r >= 0 && r < 8 && c >= 0 && c < 8 && room.board[r][c] === opponent) {
                flips.push({ r, c });
                r += dr;
                c += dc;
            }
            if (r >= 0 && r < 8 && c >= 0 && c < 8 && room.board[r][c] === color && flips.length > 0) {
                flips.forEach(p => room.board[p.r][p.c] = color);
            }
        }

        // --- ここから追加・修正ロジック ---

        // 次のターンの判定（パス判定、ゲーム終了判定）
        const nextTurnColor = opponent;
        const currentTurnColor = color;

        const nextCanMove = hasValidMoves(room.board, nextTurnColor);
        const currentCanMove = hasValidMoves(room.board, currentTurnColor);

        if (nextCanMove) {
            // 普通に交代
            room.turn = nextTurnColor;
            io.to(roomId).emit('update_board', { board: room.board, turn: room.turn });

        } else if (currentCanMove) {
            // 相手が置けないが、自分は置ける -> パス
            // ターンは今の人のまま
            io.to(roomId).emit('update_board', { board: room.board, turn: currentTurnColor });
            io.to(roomId).emit('notification', `${nextTurnColor.toUpperCase()} has no moves! PASS.`);

        } else {
            // 両者とも置けない -> ゲーム終了
            const scores = countScore(room.board);
            let winner = 'draw';
            if (scores.black > scores.white) winner = 'black';
            if (scores.white > scores.black) winner = 'white';

            room.status = 'FINISHED';
            io.to(roomId).emit('game_over', {
                board: room.board,
                winner,
                blackScore: scores.black,
                whiteScore: scores.white
            });

            // ゲームが終わったら部屋を削除してもいいが、結果表示のために少し残す
            // ここでは削除せず、プレイヤーが退出したときに削除する
        }
    });

    // 切断時の処理（重要：部屋をきれいにする）
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // ユーザーが所属していた部屋を探す
        // roomIDをsocketに保存していない場合は全探索が必要だが、
        // 上記 join_room で socket.currentRoom に保存するようにした
        const roomId = socket.currentRoom;

        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];

            // プレイヤーリストから削除
            room.players = room.players.filter(p => p.id !== socket.id);

            // もしゲーム中だったら「切断による終了」を通知
            if (room.status === 'PLAYING') {
                room.status = 'ABORTED';
                io.to(roomId).emit('player_left');
            }

            // 誰もいなくなったら部屋自体を削除（これでRoom IDが再利用可能になる）
            if (room.players.length === 0) {
                delete rooms[roomId];
                console.log(`Room ${roomId} deleted.`);
            }
        }
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});