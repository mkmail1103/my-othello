import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

// ==========================================
// SHARED TYPES
// ==========================================
export type PlayerColor = 'black' | 'white';
export type CellState = PlayerColor | null;
export type BoardState = CellState[][];

enum GameMode {
    MENU = 'MENU',
    OTHELLO = 'OTHELLO',
    BLOCK_PUZZLE = 'BLOCK_PUZZLE'
}

enum OthelloStatus {
    LOBBY = 'LOBBY',
    WAITING = 'WAITING',
    PLAYING = 'PLAYING',
    FINISHED = 'FINISHED',
    ABORTED = 'ABORTED'
}

// ==========================================
// BLOCK PUZZLE LOGIC & CONSTANTS
// ==========================================

// Simple shapes definition (0: empty, 1: filled)
// Adding an 'id' and 'color' to definitions for styling
type ShapeDef = {
    id: string;
    matrix: number[][];
    color: string;
};

const PUZZLE_SHAPES: ShapeDef[] = [
    { id: 'DOT', matrix: [[1]], color: '#fbbf24' }, // Yellow
    { id: 'I2', matrix: [[1, 1]], color: '#34d399' }, // Green
    { id: 'I3', matrix: [[1, 1, 1]], color: '#60a5fa' }, // Blue
    { id: 'I4', matrix: [[1, 1, 1, 1]], color: '#818cf8' }, // Indigo
    { id: 'SQR', matrix: [[1, 1], [1, 1]], color: '#f87171' }, // Red
    { id: 'L3', matrix: [[1, 0], [1, 1]], color: '#a78bfa' }, // Purple
    { id: 'J3', matrix: [[0, 1], [1, 1]], color: '#fb923c' }, // Orange
    { id: 'T3', matrix: [[1, 1, 1], [0, 1, 0]], color: '#e879f9' }, // Pink
    { id: 'Z3', matrix: [[1, 1, 0], [0, 1, 1]], color: '#2dd4bf' }, // Teal
];

const getRandomShapes = (count: number) => {
    const shapes = [];
    for (let i = 0; i < count; i++) {
        const rand = PUZZLE_SHAPES[Math.floor(Math.random() * PUZZLE_SHAPES.length)];
        shapes.push(rand);
    }
    return shapes;
};

// ==========================================
// COMPONENTS: OTHELLO
// ==========================================

const Disc = ({ color }: { color: PlayerColor }) => (
    <div className={`disc ${color}`}></div>
);

const OthelloGame: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [roomID, setRoomID] = useState<string>('');
    const [inputRoomID, setInputRoomID] = useState<string>('');
    const [status, setStatus] = useState<OthelloStatus>(OthelloStatus.LOBBY);
    const [myColor, setMyColor] = useState<PlayerColor | null>(null);
    const [turn, setTurn] = useState<PlayerColor>('black');
    const [board, setBoard] = useState<BoardState>(
        Array(8).fill(null).map(() => Array(8).fill(null))
    );
    const [scores, setScores] = useState({ black: 2, white: 2 });
    const [winner, setWinner] = useState<PlayerColor | 'draw' | null>(null);
    const [notification, setNotification] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Othello logic helpers
    const getValidMoves = useCallback((currentBoard: BoardState, player: PlayerColor) => {
        const moves: { r: number; c: number }[] = [];
        const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (currentBoard[r][c] !== null) continue;
                let isValid = false;
                const opponent = player === 'black' ? 'white' : 'black';
                for (const [dr, dc] of directions) {
                    let nr = r + dr;
                    let nc = c + dc;
                    let foundOpponent = false;
                    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && currentBoard[nr][nc] === opponent) {
                        foundOpponent = true;
                        nr += dr;
                        nc += dc;
                    }
                    if (foundOpponent && nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && currentBoard[nr][nc] === player) {
                        isValid = true;
                        break;
                    }
                }
                if (isValid) moves.push({ r, c });
            }
        }
        return moves;
    }, []);

    const calculateScores = useCallback((currentBoard: BoardState) => {
        let b = 0; let w = 0;
        currentBoard.forEach(row => row.forEach(cell => {
            if (cell === 'black') b++;
            if (cell === 'white') w++;
        }));
        setScores({ black: b, white: w });
    }, []);

    // Socket Setup
    useEffect(() => {
        const newSocket = io();
        setSocket(newSocket);
        return () => { newSocket.disconnect(); };
    }, []);

    useEffect(() => {
        if (!socket) return;
        socket.on('init_game', ({ color, roomId }) => { setMyColor(color); setRoomID(roomId); });
        socket.on('waiting_opponent', () => { setStatus(OthelloStatus.WAITING); setError(null); });
        socket.on('game_start', ({ board, turn }) => {
            setBoard(board); setTurn(turn); setStatus(OthelloStatus.PLAYING); calculateScores(board);
        });
        socket.on('update_board', ({ board, turn }) => {
            setBoard(board); setTurn(turn); calculateScores(board);
        });
        socket.on('notification', (msg) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); });
        socket.on('player_left', () => { setStatus(OthelloStatus.ABORTED); setRoomID(''); setMyColor(null); });
        socket.on('game_over', ({ board, winner, blackScore, whiteScore }) => {
            setBoard(board); setScores({ black: blackScore, white: whiteScore });
            setWinner(winner); setStatus(OthelloStatus.FINISHED);
        });
        socket.on('error_message', (msg) => { setError(msg); setTimeout(() => setError(null), 3000); });
        return () => {
            socket.removeAllListeners();
        };
    }, [socket, calculateScores]);

    const handleJoinRoom = () => {
        if (!inputRoomID.trim() || !socket) return;
        socket.emit('join_room', { roomId: inputRoomID, playerName: 'Player' });
    };

    const handleCellClick = (r: number, c: number) => {
        if (status !== OthelloStatus.PLAYING || turn !== myColor || !socket) return;
        if (board[r][c] !== null) return;
        const validMoves = getValidMoves(board, myColor);
        if (validMoves.some(m => m.r === r && m.c === c)) {
            socket.emit('make_move', { roomId: roomID, row: r, col: c });
        }
    };

    const validMoves = useMemo(() => {
        if (status === OthelloStatus.PLAYING && turn === myColor && myColor) {
            return getValidMoves(board, myColor);
        }
        return [];
    }, [board, status, turn, myColor, getValidMoves]);

    // RENDER LOBBY
    if (status === OthelloStatus.LOBBY) {
        return (
            <div className="lobby-container">
                <div className="lobby-card">
                    <button onClick={onBack} className="back-link">← Back to Menu</button>
                    <h1 className="title">Othello Lobby</h1>
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
                    <button onClick={handleJoinRoom} className="join-btn">Join / Create Room</button>
                    {error && <div className="error-msg">{error}</div>}
                </div>
            </div>
        );
    }

    // RENDER GAME
    return (
        <div className="game-container">
            {status === OthelloStatus.FINISHED && (
                <div className="result-overlay">
                    <div className={`result-card ${winner === myColor ? 'win' : winner === 'draw' ? 'draw' : 'lose'}`}>
                        <h1 className="result-title">{winner === 'draw' ? 'DRAW' : winner === myColor ? 'VICTORY!' : 'DEFEAT'}</h1>
                        <div className="final-score">
                            <div className="score-box"><span className="label">BLACK</span><span className="value">{scores.black}</span></div>
                            <div className="vs">vs</div>
                            <div className="score-box"><span className="label">WHITE</span><span className="value">{scores.white}</span></div>
                        </div>
                        <button onClick={() => window.location.reload()} className="rematch-btn">Leave Room</button>
                    </div>
                </div>
            )}

            <div className="scoreboard">
                <div className={`player-info ${turn === 'black' ? 'active-turn' : ''}`}>
                    <div className="score-indicator black"></div>
                    <div className="score-text"><span>BLACK {myColor === 'black' && <span className="you-tag">YOU</span>}</span><span className="score-value">{scores.black}</span></div>
                </div>
                <div className="game-status">
                    <div className="room-id">Room: {roomID}</div>
                    <div className={`status-badge ${myColor === turn ? 'my-turn' : ''}`}>
                        {status === OthelloStatus.WAITING ? 'Waiting for opponent...' :
                            status === OthelloStatus.FINISHED ? 'GAME OVER' :
                                status === OthelloStatus.ABORTED ? 'Opponent Disconnected' :
                                    myColor === turn ? 'YOUR TURN' : "OPPONENT'S TURN"}
                    </div>
                </div>
                <div className={`player-info ${turn === 'white' ? 'active-turn' : ''}`}>
                    <div className="score-text" style={{ textAlign: 'right' }}><span>WHITE {myColor === 'white' && <span className="you-tag">YOU</span>}</span><span className="score-value">{scores.white}</span></div>
                    <div className="score-indicator white"></div>
                </div>
            </div>

            {notification && <div className="notification-toast">{notification}</div>}

            <div className="board-wrapper">
                <div className="board">
                    {board.map((row, r) => row.map((cell, c) => {
                        const isValid = validMoves.some(m => m.r === r && m.c === c);
                        return (
                            <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)} className={`cell ${isValid ? 'valid' : ''}`}>
                                {isValid && <div className="valid-marker" />}
                                {cell && <Disc color={cell} />}
                                {c === 0 && <span className="coord-y">{r + 1}</span>}
                                {r === 7 && <span className="coord-x">{String.fromCharCode(65 + c)}</span>}
                            </div>
                        );
                    }))}
                </div>
            </div>

            <div className="controls">
                <button onClick={onBack} className="leave-btn">Exit to Menu</button>
            </div>
        </div>
    );
};

// ==========================================
// COMPONENTS: BLOCK PUZZLE
// ==========================================

const BlockPuzzleGame: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    // 8x8 Grid, stores color string or null
    const [grid, setGrid] = useState<(string | null)[][]>(
        Array(8).fill(null).map(() => Array(8).fill(null))
    );
    const [hand, setHand] = useState<(ShapeDef | null)[]>([]);
    const [score, setScore] = useState(0);
    const [selectedShapeIdx, setSelectedShapeIdx] = useState<number | null>(null);
    const [hoverPos, setHoverPos] = useState<{ r: number, c: number } | null>(null);
    const [isGameOver, setIsGameOver] = useState(false);
    const [combo, setCombo] = useState(0);

    // Initial load
    useEffect(() => {
        setHand(getRandomShapes(3));
    }, []);

    // Refill hand if empty
    useEffect(() => {
        if (hand.length > 0 && hand.every(h => h === null)) {
            setHand(getRandomShapes(3));
        }
    }, [hand]);

    // Check Game Over whenever hand or grid changes
    useEffect(() => {
        if (hand.every(h => h === null)) return; // Don't check if about to refill

        // Try to find AT LEAST ONE valid move for ANY remaining shape
        let canMove = false;

        for (const shape of hand) {
            if (!shape) continue;
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (canPlace(grid, shape.matrix, r, c)) {
                        canMove = true;
                        break;
                    }
                }
                if (canMove) break;
            }
            if (canMove) break;
        }

        if (!canMove) {
            setIsGameOver(true);
        }
    }, [hand, grid]);

    // Check placement validity
    const canPlace = (currentGrid: (string | null)[][], matrix: number[][], r: number, c: number) => {
        const rows = matrix.length;
        const cols = matrix[0].length;

        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                if (matrix[i][j] === 1) {
                    const nr = r + i;
                    const nc = c + j;
                    // Check bounds
                    if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) return false;
                    // Check collision
                    if (currentGrid[nr][nc] !== null) return false;
                }
            }
        }
        return true;
    };

    // Handle clicking a shape in hand
    const handleSelectShape = (idx: number) => {
        if (isGameOver) return;
        if (hand[idx] === null) return;
        // Toggle selection
        setSelectedShapeIdx(prev => prev === idx ? null : idx);
    };

    // Handle placing on board
    const handleBoardClick = () => {
        if (selectedShapeIdx === null || hoverPos === null || isGameOver) return;

        const shape = hand[selectedShapeIdx];
        if (!shape) return;

        if (canPlace(grid, shape.matrix, hoverPos.r, hoverPos.c)) {
            // Place it
            const newGrid = grid.map(row => [...row]);
            const rows = shape.matrix.length;
            const cols = shape.matrix[0].length;

            for (let i = 0; i < rows; i++) {
                for (let j = 0; j < cols; j++) {
                    if (shape.matrix[i][j] === 1) {
                        newGrid[hoverPos.r + i][hoverPos.c + j] = shape.color;
                    }
                }
            }

            // Remove from hand
            const newHand = [...hand];
            newHand[selectedShapeIdx] = null;

            setHand(newHand);
            setSelectedShapeIdx(null);
            setHoverPos(null);

            // Check lines
            checkLinesAndScore(newGrid);
        }
    };

    const checkLinesAndScore = (currentGrid: (string | null)[][]) => {
        const rowsToClear: number[] = [];
        const colsToClear: number[] = [];

        // Check Rows
        for (let r = 0; r < 8; r++) {
            if (currentGrid[r].every(cell => cell !== null)) {
                rowsToClear.push(r);
            }
        }
        // Check Cols
        for (let c = 0; c < 8; c++) {
            let full = true;
            for (let r = 0; r < 8; r++) {
                if (currentGrid[r][c] === null) {
                    full = false;
                    break;
                }
            }
            if (full) colsToClear.push(c);
        }

        const totalLines = rowsToClear.length + colsToClear.length;

        if (totalLines > 0) {
            const newCombo = combo + 1;
            setCombo(newCombo);

            // Score calculation (Base 10 + 10 per cell + bonus for lines + combo)
            const points = (totalLines * 100) * newCombo;
            setScore(prev => prev + points);

            // Clear cells
            rowsToClear.forEach(r => {
                for (let c = 0; c < 8; c++) currentGrid[r][c] = null;
            });
            colsToClear.forEach(c => {
                for (let r = 0; r < 8; r++) currentGrid[r][c] = null;
            });

            setGrid(currentGrid);
        } else {
            setCombo(0);
            setScore(prev => prev + 10); // Placement points
            setGrid(currentGrid);
        }
    };

    // Calculate ghost cells for rendering
    const ghostCells = useMemo(() => {
        if (selectedShapeIdx === null || hoverPos === null) return [];
        const shape = hand[selectedShapeIdx];
        if (!shape) return [];

        if (canPlace(grid, shape.matrix, hoverPos.r, hoverPos.c)) {
            const cells = [];
            const rows = shape.matrix.length;
            const cols = shape.matrix[0].length;
            for (let i = 0; i < rows; i++) {
                for (let j = 0; j < cols; j++) {
                    if (shape.matrix[i][j] === 1) {
                        cells.push(`${hoverPos.r + i}-${hoverPos.c + j}`);
                    }
                }
            }
            return cells;
        }
        return [];
    }, [selectedShapeIdx, hoverPos, grid, hand]);

    return (
        <div className="game-container puzzle-mode">
            {isGameOver && (
                <div className="result-overlay">
                    <div className="result-card lose">
                        <h1 className="result-title">GAME OVER</h1>
                        <div className="final-score">
                            <div className="score-box"><span className="label">SCORE</span><span className="value">{score}</span></div>
                        </div>
                        <button onClick={() => window.location.reload()} className="rematch-btn">Try Again</button>
                    </div>
                </div>
            )}

            <div className="scoreboard">
                <div className="score-box" style={{ alignItems: 'flex-start' }}>
                    <span className="label">SCORE</span>
                    <span className="value">{score}</span>
                </div>
                {combo > 1 && <div className="combo-badge">{combo}x COMBO!</div>}
                <button onClick={onBack} className="leave-btn">Exit</button>
            </div>

            <div className="board-wrapper">
                <div className="board puzzle-board" onMouseLeave={() => setHoverPos(null)}>
                    {grid.map((row, r) => row.map((cell, c) => {
                        const isGhost = ghostCells.includes(`${r}-${c}`);
                        return (
                            <div
                                key={`${r}-${c}`}
                                className={`cell puzzle-cell ${isGhost ? 'ghost-active' : ''}`}
                                style={cell ? { backgroundColor: cell, boxShadow: 'inset 0 0 10px rgba(0,0,0,0.2)' } : {}}
                                onMouseEnter={() => setHoverPos({ r, c })}
                                onClick={handleBoardClick}
                            >
                                {/* If it's a ghost, show light preview */}
                                {isGhost && <div className="ghost-overlay" />}
                            </div>
                        );
                    }))}
                </div>
            </div>

            <div className="hand-container">
                {hand.map((shape, idx) => (
                    <div
                        key={idx}
                        className={`shape-item ${selectedShapeIdx === idx ? 'selected' : ''} ${shape === null ? 'used' : ''}`}
                        onClick={() => handleSelectShape(idx)}
                    >
                        {shape && (
                            <div
                                className="mini-grid"
                                style={{
                                    gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)`,
                                    width: `${shape.matrix[0].length * 20}px`
                                }}
                            >
                                {shape.matrix.map((row, r) => row.map((val, c) => (
                                    <div
                                        key={`${r}-${c}`}
                                        className="mini-cell"
                                        style={{ backgroundColor: val ? shape.color : 'transparent' }}
                                    />
                                )))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <div className="instructions">
                Select a shape below, then click on the board to place it.
            </div>
        </div>
    );
};

// ==========================================
// MAIN APP & MENU
// ==========================================

const App: React.FC = () => {
    const [gameMode, setGameMode] = useState<GameMode>(GameMode.MENU);

    if (gameMode === GameMode.MENU) {
        return (
            <div className="lobby-container">
                <div className="lobby-card menu-card">
                    <h1 className="title">Game Menu</h1>
                    <div className="menu-buttons">
                        <button onClick={() => setGameMode(GameMode.OTHELLO)} className="menu-btn othello-btn">
                            <span className="icon">⚫⚪</span>
                            <div className="text">
                                <span className="main">Online Othello</span>
                                <span className="sub">PVP Strategy</span>
                            </div>
                        </button>
                        <button onClick={() => setGameMode(GameMode.BLOCK_PUZZLE)} className="menu-btn puzzle-btn">
                            <span className="icon">🧩</span>
                            <div className="text">
                                <span className="main">Block Puzzle</span>
                                <span className="sub">Solo Relaxing</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (gameMode === GameMode.OTHELLO) {
        return <OthelloGame onBack={() => setGameMode(GameMode.MENU)} />;
    }

    if (gameMode === GameMode.BLOCK_PUZZLE) {
        return <BlockPuzzleGame onBack={() => setGameMode(GameMode.MENU)} />;
    }

    return null;
};

export default App;