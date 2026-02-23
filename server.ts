import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { PUZZLE_SHAPES, ShapeDef } from './src/constants.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const PORT = 3000;

// --- Helper Functions ---

// Othello Helpers
function hasValidMoves(board: (string | null)[][], color: string) {
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
                    return true;
                }
            }
        }
    }
    return false;
}

function countScore(board: (string | null)[][]) {
    let black = 0;
    let white = 0;
    board.forEach(row => row.forEach(cell => {
        if (cell === 'black') black++;
        if (cell === 'white') white++;
    }));
    return { black, white };
}

// Puzzle Helpers
function canPlace(grid: (string | null)[][], matrix: number[][], r: number, c: number) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (matrix[i][j] === 1) {
                const nr = r + i;
                const nc = c + j;
                if (nr < 0 || nr >= 10 || nc < 0 || nc >= 10) return false; // 10x10 board
                if (grid[nr][nc] !== null) return false;
            }
        }
    }
    return true;
}

function getRandomShapes(count: number): ShapeDef[] {
    const shapes: ShapeDef[] = [];
    for (let i = 0; i < count; i++) {
        shapes.push(PUZZLE_SHAPES[Math.floor(Math.random() * PUZZLE_SHAPES.length)]);
    }
    return shapes;
}

function hasAnyValidMove(grid: (string | null)[][], hand: (ShapeDef | null)[]) {
    for (const shape of hand) {
        if (!shape) continue;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 10; c++) {
                if (canPlace(grid, shape.matrix, r, c)) return true;
            }
        }
    }
    return false;
}


// --- Main Server Setup ---

async function startServer() {
    // Vite Middleware
    if (process.env.NODE_ENV !== 'production') {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'spa',
        });
        app.use(vite.middlewares);
    } else {
        app.use(express.static(path.join(__dirname, 'dist')));
        app.get('(.*)', (_req: Request, res: Response) => {
            res.sendFile(path.join(__dirname, 'dist', 'index.html'));
        });
    }

    const io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    // --- Types ---
    interface Player {
        id: string;
        name: string;
        color: string;
    }

    interface Room {
        type: 'OTHELLO' | 'PUZZLE';
        board: (string | null)[][];
        turn: string;
        players: Player[];
        status: 'WAITING' | 'PLAYING' | 'FINISHED' | 'ABORTED';
        hands?: { black: (ShapeDef | null)[], white: (ShapeDef | null)[] };
        scores?: { black: number, white: number };
    }

    interface Flip {
        r: number;
        c: number;
    }

    const rooms: { [key: string]: Room } = {};

    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (socket as any).currentRoom = null;

        // --- Othello Join ---
        socket.on('join_room', ({ roomId, playerName }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const currentRoomId = (socket as any).currentRoom;
            if (currentRoomId) socket.leave(currentRoomId);
            socket.join(roomId);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (socket as any).currentRoom = roomId;

            if (!rooms[roomId]) {
                rooms[roomId] = {
                    type: 'OTHELLO',
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
            if (room.type !== 'OTHELLO') {
                socket.emit('error_message', 'Room exists but is not for Othello!');
                return;
            }

            if (room.players.length >= 2) {
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
                io.to(roomId).emit('game_start', { board: room.board, turn: room.turn });
            }
        });

        // --- Puzzle Join ---
        socket.on('join_puzzle_room', ({ roomId, playerName }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((socket as any).currentRoom) socket.leave((socket as any).currentRoom);
            socket.join(roomId);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (socket as any).currentRoom = roomId;

            if (!rooms[roomId]) {
                rooms[roomId] = {
                    type: 'PUZZLE',
                    board: Array(10).fill(null).map(() => Array(10).fill(null)), // 10x10 Board
                    turn: 'black', // 'black' starts
                    players: [],
                    status: 'WAITING',
                    hands: { black: getRandomShapes(3), white: getRandomShapes(3) },
                    scores: { black: 0, white: 0 }
                };
            }

            const room = rooms[roomId];
            if (room.type !== 'PUZZLE') {
                socket.emit('error_message', 'Room exists but is not for Block Puzzle!');
                return;
            }

            if (room.players.length >= 2) {
                socket.emit('error_message', 'Room is full!');
                return;
            }

            const color = room.players.length === 0 ? 'black' : 'white';
            room.players.push({ id: socket.id, name: playerName, color });

            socket.emit('init_puzzle_game', { color, roomId });

            if (room.players.length === 1) {
                socket.emit('waiting_opponent');
            } else {
                room.status = 'PLAYING';
                // Refill hands just in case (though already init)
                if (room.hands) {
                    if (room.hands.black.length === 0) room.hands.black = getRandomShapes(3);
                    if (room.hands.white.length === 0) room.hands.white = getRandomShapes(3);
                }

                io.to(roomId).emit('puzzle_start', {
                    board: room.board,
                    turn: room.turn,
                    hands: room.hands,
                    scores: room.scores
                });
            }
        });


        // --- Othello Move ---
        socket.on('make_move', ({ roomId, row, col }) => {
            const room = rooms[roomId];
            if (!room || room.status !== 'PLAYING' || room.type !== 'OTHELLO') return;

            const color = room.turn;
            if (room.board[row][col] !== null) return;

            room.board[row][col] = color;

            const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
            const opponent = color === 'black' ? 'white' : 'black';

            for (const [dr, dc] of directions) {
                let r = row + dr;
                let c = col + dc;
                const flips: Flip[] = [];
                while (r >= 0 && r < 8 && c >= 0 && c < 8 && room.board[r][c] === opponent) {
                    flips.push({ r, c });
                    r += dr;
                    c += dc;
                }
                if (r >= 0 && r < 8 && c >= 0 && c < 8 && room.board[r][c] === color && flips.length > 0) {
                    flips.forEach((p: Flip) => room.board[p.r][p.c] = color);
                }
            }

            const nextTurnColor = opponent;
            const currentTurnColor = color;
            const nextCanMove = hasValidMoves(room.board, nextTurnColor);
            const currentCanMove = hasValidMoves(room.board, currentTurnColor);

            if (nextCanMove) {
                room.turn = nextTurnColor;
                io.to(roomId).emit('update_board', { board: room.board, turn: room.turn });
            } else if (currentCanMove) {
                io.to(roomId).emit('update_board', { board: room.board, turn: currentTurnColor });
                io.to(roomId).emit('notification', `${nextTurnColor.toUpperCase()} has no moves! PASS.`);
            } else {
                const scores = countScore(room.board);
                let winner = 'draw';
                if (scores.black > scores.white) winner = 'black';
                if (scores.white > scores.black) winner = 'white';
                room.status = 'FINISHED';
                io.to(roomId).emit('game_over', { board: room.board, winner, blackScore: scores.black, whiteScore: scores.white });
            }
        });

        // --- Puzzle Move ---
        socket.on('puzzle_move', ({ roomId, shapeIndex, row, col }) => {
            const room = rooms[roomId];
            if (!room || room.status !== 'PLAYING' || room.type !== 'PUZZLE') return;

            const color = room.turn as 'black' | 'white';
            // Validate turn? Ideally yes, but client handles it too.
            // We assume socket.id matches turn player, but for simplicity just trust room.turn

            if (!room.hands || !room.scores) return;

            const hand = room.hands[color];
            const shape = hand[shapeIndex];
            if (!shape) return; // Invalid shape index

            if (!canPlace(room.board, shape.matrix, row, col)) return; // Invalid move

            // Place shape
            let placementScore = 0;
            for (let r = 0; r < shape.matrix.length; r++) {
                for (let c = 0; c < shape.matrix[0].length; c++) {
                    if (shape.matrix[r][c] === 1) {
                        room.board[row + r][col + c] = color; // Use player color
                        placementScore++;
                    }
                }
            }

            // Remove from hand
            hand[shapeIndex] = null;

            // Check Clears
            const rowsToClear: number[] = [];
            const colsToClear: number[] = [];
            for (let r = 0; r < 10; r++) { if (room.board[r].every((c: string | null) => c !== null)) rowsToClear.push(r); }
            for (let c = 0; c < 10; c++) {
                let full = true;
                for (let r = 0; r < 10; r++) { if (room.board[r][c] === null) { full = false; break; } }
                if (full) colsToClear.push(c);
            }

            const totalLines = rowsToClear.length + colsToClear.length;
            let moveScore = placementScore;
            if (totalLines > 0) {
                moveScore += totalLines * 100; // Simplified scoring
                // Clear lines
                rowsToClear.forEach(r => { for (let c = 0; c < 10; c++) room.board[r][c] = null; });
                colsToClear.forEach(c => { for (let r = 0; r < 10; r++) room.board[r][c] = null; });
            }

            if (room.scores) {
                room.scores[color as 'black' | 'white'] += moveScore;
            }

            // Refill hand if empty
            if (hand.every((h: ShapeDef | null) => h === null)) {
                if (room.hands) {
                    room.hands[color as 'black' | 'white'] = getRandomShapes(3);
                }
            }

            // Switch Turn
            const nextTurn = color === 'black' ? 'white' : 'black';
            room.turn = nextTurn;

            // Check if NEXT player can move
            const nextHand = room.hands[nextTurn as 'black' | 'white'];
            const canNextMove = hasAnyValidMove(room.board, nextHand);

            if (!canNextMove) {
                // Game Over! Next player loses.
                room.status = 'FINISHED';
                io.to(roomId).emit('puzzle_game_over', {
                    winner: color, // Current player wins because next cannot move
                    reason: 'no_moves',
                    board: room.board,
                    scores: room.scores
                });
            } else {
                // Continue
                io.to(roomId).emit('update_puzzle_state', {
                    board: room.board,
                    turn: room.turn,
                    hands: room.hands,
                    scores: room.scores,
                    lastMove: { row, col, shapeId: shape.id }
                });
            }
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const roomId = (socket as any).currentRoom;
            if (roomId && rooms[roomId]) {
                const room = rooms[roomId];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                room.players = room.players.filter((p: Player) => p.id !== socket.id);

                if (room.status === 'PLAYING') {
                    room.status = 'ABORTED';
                    io.to(roomId).emit('player_left');
                }

                if (room.players.length === 0) {
                    delete rooms[roomId];
                }
            }
        });
    });

    httpServer.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer();