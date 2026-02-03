import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

// --- Type Definitions (Integrated) ---
export type PlayerColor = 'black' | 'white';
export type CellState = PlayerColor | null;
export type BoardState = CellState[][];

export interface Player {
    id: string;
    color: PlayerColor;
}

enum GameStatus {
    LOBBY = 'LOBBY',
    WAITING = 'WAITING',
    PLAYING = 'PLAYING',
    FINISHED = 'FINISHED',
    ABORTED = 'ABORTED'
}

// Connect to backend


// --- Components ---

// Disc Component
const Disc = ({ color }: { color: PlayerColor }) => (
    <div className={`disc ${color}`}></div>
);

// Helper: Client-side valid move checker for highlighting
const getValidMoves = (board: BoardState, player: PlayerColor) => {
    const moves: { r: number; c: number }[] = [];
    const directions = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1]
    ];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] !== null) continue;
            let isValid = false;
            const opponent = player === 'black' ? 'white' : 'black';

            for (const [dr, dc] of directions) {
                let nr = r + dr;
                let nc = c + dc;
                let foundOpponent = false;

                while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === opponent) {
                    foundOpponent = true;
                    nr += dr;
                    nc += dc;
                }

                if (foundOpponent && nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === player) {
                    isValid = true;
                    break;
                }
            }
            if (isValid) moves.push({ r, c });
        }
    }
    return moves;
};

// Main App Component
const App: React.FC = () => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [roomID, setRoomID] = useState<string>('');
    const [inputRoomID, setInputRoomID] = useState<string>('');
    const [status, setStatus] = useState<GameStatus>(GameStatus.LOBBY);
    const [myColor, setMyColor] = useState<PlayerColor | null>(null);
    const [turn, setTurn] = useState<PlayerColor>('black');
    const [board, setBoard] = useState<BoardState>(
        Array(8).fill(null).map(() => Array(8).fill(null))
    );
    const [scores, setScores] = useState({ black: 2, white: 2 });
    const [winner, setWinner] = useState<PlayerColor | 'draw' | null>(null);
    const [notification, setNotification] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Initialize Socket
    useEffect(() => {
        const newSocket = io();
        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, []);

    // Socket Event Listeners
    useEffect(() => {
        if (!socket) return;

        socket.on('init_game', ({ color, roomId }) => {
            setMyColor(color);
            setRoomID(roomId);
        });

        socket.on('waiting_opponent', () => {
            setStatus(GameStatus.WAITING);
            setError(null);
        });

        socket.on('game_start', ({ board, turn }) => {
            setBoard(board);
            setTurn(turn);
            setStatus(GameStatus.PLAYING);
            calculateScores(board);
        });

        socket.on('update_board', ({ board, turn }) => {
            setBoard(board);
            setTurn(turn);
            calculateScores(board);
        });

        socket.on('notification', (msg) => {
            setNotification(msg);
            setTimeout(() => setNotification(null), 3000);
        });

        socket.on('player_left', () => {
            setStatus(GameStatus.ABORTED);
            setRoomID('');
            setMyColor(null);
        });

        socket.on('game_over', ({ board, winner, blackScore, whiteScore }) => {
            setBoard(board);
            setScores({ black: blackScore, white: whiteScore });
            setWinner(winner);
            setStatus(GameStatus.FINISHED);
        });

        socket.on('error_message', (msg) => {
            setError(msg);
            setTimeout(() => setError(null), 3000);
        });

        return () => {
            socket.off('init_game');
            socket.off('waiting_opponent');
            socket.off('game_start');
            socket.off('update_board');
            socket.off('notification');
            socket.off('player_left');
            socket.off('game_over');
            socket.off('error_message');
        };
    }, [socket]);

    const calculateScores = useCallback((currentBoard: BoardState) => {
        let b = 0;
        let w = 0;
        currentBoard.forEach(row => row.forEach(cell => {
            if (cell === 'black') b++;
            if (cell === 'white') w++;
        }));
        setScores({ black: b, white: w });
    }, []);

    const handleJoinRoom = () => {
        if (!inputRoomID.trim() || !socket) return;
        socket.emit('join_room', {
            roomId: inputRoomID,
            playerName: 'Player' // © ‚Æ‚è‚ ‚¦‚¸ŒÅ’è‚ÅOK
        });
    };

    const handleCellClick = (r: number, c: number) => {
        if (status !== GameStatus.PLAYING || turn !== myColor || !socket) return;
        if (board[r][c] !== null) return;

        // Optimistic check
        const validMoves = getValidMoves(board, myColor);
        const isValid = validMoves.some(m => m.r === r && m.c === c);

        if (isValid) {
            socket.emit('make_move', { roomId: roomID, row: r, col: c });
        }
    };

    // Memoize valid moves for highlighting
    const validMoves = useMemo(() => {
        if (status === GameStatus.PLAYING && turn === myColor && myColor) {
            return getValidMoves(board, myColor);
        }
        return [];
    }, [board, status, turn, myColor]);

    // --- RENDER ---

    if (status === GameStatus.LOBBY) {
        return (
            <div className="lobby-container">
                <div className="lobby-card">
                    <h1 className="title">Othello Live</h1>
                    <div className="input-group">
                        <label>Room ID</label>
                        <input
                            type="text"
                            value={inputRoomID}
                            onChange={(e) => setInputRoomID(e.target.value)}
                            placeholder="Enter room name..."
                            onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                        />
                    </div>
                    <button onClick={handleJoinRoom} className="join-btn">
                        Join Game
                    </button>
                    {error && <div className="error-msg">{error}</div>}
                </div>
            </div>
        );
    }

    return (
        <div className="game-container">
            {/* HUD / Scoreboard */}
            <div className="scoreboard">
                <div className={`player-info ${turn === 'black' ? 'active-turn' : ''}`}>
                    <div className="score-indicator black"></div>
                    <div className="score-text">
                        <span>BLACK</span>
                        <span className="score-value">{scores.black}</span>
                    </div>
                </div>

                <div className="game-status">
                    <div className="room-id">Room: {roomID}</div>
                    <div className={`status-badge ${myColor === turn ? 'my-turn' : ''}`}>
                        {status === GameStatus.WAITING ? 'Waiting for opponent...' :
                            status === GameStatus.FINISHED ? (winner === 'draw' ? 'Draw!' : `${winner?.toUpperCase()} Wins!`) :
                                status === GameStatus.ABORTED ? 'Opponent Disconnected' :
                                    myColor === turn ? 'YOUR TURN' : "OPPONENT'S TURN"}
                    </div>
                </div>

                <div className={`player-info ${turn === 'white' ? 'active-turn' : ''}`}>
                    <div className="score-text" style={{ textAlign: 'right' }}>
                        <span>WHITE</span>
                        <span className="score-value">{scores.white}</span>
                    </div>
                    <div className="score-indicator white"></div>
                </div>
            </div>

            {notification && (
                <div className="notification-toast">
                    {notification}
                </div>
            )}

            {/* Board */}
            <div className="board-wrapper">
                <div className="board">
                    {board.map((row, r) => (
                        row.map((cell, c) => {
                            const isValid = validMoves.some(m => m.r === r && m.c === c);
                            return (
                                <div
                                    key={`${r}-${c}`}
                                    onClick={() => handleCellClick(r, c)}
                                    className={`cell ${isValid ? 'valid' : ''}`}
                                >
                                    {isValid && <div className="valid-marker" />}
                                    {cell && <Disc color={cell} />}

                                    {/* Coordinates */}
                                    {c === 0 && <span className="coord-y">{r + 1}</span>}
                                    {r === 7 && <span className="coord-x">{String.fromCharCode(65 + c)}</span>}
                                </div>
                            );
                        })
                    ))}
                </div>
            </div>

            {/* Controls */}
            <div className="controls">
                {(status === GameStatus.FINISHED || status === GameStatus.ABORTED) && (
                    <button onClick={() => window.location.reload()} className="leave-btn">
                        Back to Lobby
                    </button>
                )}
            </div>
        </div>
    );
};

export default App;