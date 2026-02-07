import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
                    <h1 className="title neon-text">Othello Lobby</h1>
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
                    <button onClick={handleJoinRoom} className="join-btn neon-btn">Join / Create Room</button>
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
                        <h1 className="result-title neon-text">{winner === 'draw' ? 'DRAW' : winner === myColor ? 'VICTORY!' : 'DEFEAT'}</h1>
                        <div className="final-score">
                            <div className="score-box"><span className="label">BLACK</span><span className="value">{scores.black}</span></div>
                            <div className="vs">vs</div>
                            <div className="score-box"><span className="label">WHITE</span><span className="value">{scores.white}</span></div>
                        </div>
                        <button onClick={() => window.location.reload()} className="rematch-btn">Leave Room</button>
                    </div>
                </div>
            )}

            <div className="scoreboard glass-panel">
                <div className={`player-info ${turn === 'black' ? 'active-turn' : ''}`}>
                    <div className="score-indicator black"></div>
                    <div className="score-text"><span>BLACK {myColor === 'black' && <span className="you-tag">YOU</span>}</span><span className="score-value">{scores.black}</span></div>
                </div>
                <div className="game-status">
                    <div className="room-id">Room: {roomID}</div>
                    <div className={`status-badge ${myColor === turn ? 'my-turn' : ''}`}>
                        {status === OthelloStatus.WAITING ? 'Waiting...' :
                            status === OthelloStatus.FINISHED ? 'GAME OVER' :
                                status === OthelloStatus.ABORTED ? 'Left' :
                                    myColor === turn ? 'YOUR TURN' : "OPPONENT"}
                    </div>
                </div>
                <div className={`player-info ${turn === 'white' ? 'active-turn' : ''}`}>
                    <div className="score-text" style={{ textAlign: 'right' }}><span>WHITE {myColor === 'white' && <span className="you-tag">YOU</span>}</span><span className="score-value">{scores.white}</span></div>
                    <div className="score-indicator white"></div>
                </div>
            </div>

            {notification && <div className="notification-toast">{notification}</div>}

            <div className="board-wrapper glass-panel">
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

// Helper: Can Place? - Defined outside component for safe usage in useMemo
const canPlace = (currentGrid: (string | null)[][], matrix: number[][], r: number, c: number) => {
    const rows = matrix.length;
    const cols = matrix[0].length;

    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (matrix[i][j] === 1) {
                const nr = r + i;
                const nc = c + j;
                if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) return false;
                if (currentGrid[nr][nc] !== null) return false;
            }
        }
    }
    return true;
};

const BlockPuzzleGame: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    // 8x8 Grid
    const [grid, setGrid] = useState<(string | null)[][]>(
        Array(8).fill(null).map(() => Array(8).fill(null))
    );
    // Cells that are currently clearing (for animation)
    const [clearingCells, setClearingCells] = useState<string[]>([]);

    // Initial load: Initialize state directly to avoid useEffect setState
    const [hand, setHand] = useState<(ShapeDef | null)[]>(() => getRandomShapes(3));
    const [score, setScore] = useState(0);
    const [combo, setCombo] = useState(0);

    // DRAG STATE
    // Adding hoverRow and hoverCol to avoid ref calculation in render
    const [dragState, setDragState] = useState<{
        shapeIdx: number;
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
        // Current hover position on grid
        hoverRow: number | null;
        hoverCol: number | null;
    } | null>(null);

    // Refs
    const boardRef = useRef<HTMLDivElement>(null);
    // Cache board metrics to avoid thrashing layout during drag
    const boardMetrics = useRef<{ left: number, top: number, width: number, height: number } | null>(null);

    // Refill hand
    useEffect(() => {
        if (hand.length > 0 && hand.every(h => h === null)) {
            setTimeout(() => setHand(getRandomShapes(3)), 300);
        }
    }, [hand]);

    // Check Game Over - Derived state using useMemo to avoid setState in useEffect
    const isGameOver = useMemo(() => {
        // If hand is empty (waiting for refill), it's not game over
        if (hand.every(h => h === null)) return false;
        // If clearing animation is playing, it's not game over
        if (clearingCells.length > 0) return false;

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

        return !canMove;
    }, [hand, grid, clearingCells.length]);

    // --- Drag Logic ---

    const handlePointerDown = (e: React.PointerEvent, idx: number) => {
        if (isGameOver || hand[idx] === null) return;

        const target = e.currentTarget as HTMLElement;
        // Capture pointer to track even if it leaves the element
        target.setPointerCapture(e.pointerId);

        // Cache board metrics on start drag
        if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            boardMetrics.current = {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
            };
        }

        setDragState({
            shapeIdx: idx,
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY,
            hoverRow: null,
            hoverCol: null
        });
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!dragState) return;
        e.preventDefault(); // Prevent scrolling on mobile

        const { shapeIdx } = dragState;
        const shape = hand[shapeIdx];

        let newHoverRow: number | null = null;
        let newHoverCol: number | null = null;

        // Calculate grid position using cached metrics
        if (shape && boardMetrics.current) {
            const { left, top, width } = boardMetrics.current;
            const cellSize = width / 8;
            const shapeWidthPx = shape.matrix[0].length * cellSize;
            const shapeHeightPx = shape.matrix.length * cellSize;

            // Center shape on finger (approximated logic)
            // Finger is at currentX, currentY
            // We assume finger is holding the CENTER of the shape
            // So top-left of shape is at:
            const shapeTopLeftX = e.clientX - (shapeWidthPx / 2);
            const shapeTopLeftY = e.clientY - (shapeHeightPx / 2) - 60; // -60 offset to see under finger

            const col = Math.round((shapeTopLeftX - left) / cellSize);
            const row = Math.round((shapeTopLeftY - top) / cellSize);

            // Only update if within reasonable bounds (allow slightly outside for snapping)
            if (row >= -2 && row < 10 && col >= -2 && col < 10) {
                newHoverRow = row;
                newHoverCol = col;
            }
        }

        setDragState(prev => prev ? {
            ...prev,
            currentX: e.clientX,
            currentY: e.clientY,
            hoverRow: newHoverRow,
            hoverCol: newHoverCol
        } : null);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState) return;

        const { shapeIdx, hoverRow, hoverCol } = dragState;
        const shape = hand[shapeIdx];

        // Release capture
        const target = e.currentTarget as HTMLElement;
        target.releasePointerCapture(e.pointerId);

        if (shape && hoverRow !== null && hoverCol !== null) {
            if (canPlace(grid, shape.matrix, hoverRow, hoverCol)) {
                // Place it
                const newGrid = grid.map(row => [...row]);
                const rows = shape.matrix.length;
                const cols = shape.matrix[0].length;

                for (let i = 0; i < rows; i++) {
                    for (let j = 0; j < cols; j++) {
                        if (shape.matrix[i][j] === 1) {
                            newGrid[hoverRow + i][hoverCol + j] = shape.color;
                        }
                    }
                }

                const newHand = [...hand];
                newHand[shapeIdx] = null;
                setHand(newHand);

                checkLinesAndScore(newGrid);
            }
        }

        setDragState(null);
    };

    // Calculate ghost cells purely from state during render (safe)
    const ghostCells = useMemo(() => {
        if (!dragState || dragState.hoverRow === null || dragState.hoverCol === null) return [];
        const shape = hand[dragState.shapeIdx];
        if (!shape) return [];

        const { hoverRow, hoverCol } = dragState;

        if (canPlace(grid, shape.matrix, hoverRow, hoverCol)) {
            const cells = [];
            for (let i = 0; i < shape.matrix.length; i++) {
                for (let j = 0; j < shape.matrix[0].length; j++) {
                    if (shape.matrix[i][j] === 1) {
                        cells.push(`${hoverRow + i}-${hoverCol + j}`);
                    }
                }
            }
            return cells;
        }
        return [];
    }, [dragState, grid, hand]);


    const checkLinesAndScore = (currentGrid: (string | null)[][]) => {
        const rowsToClear: number[] = [];
        const colsToClear: number[] = [];

        // Check Rows
        for (let r = 0; r < 8; r++) {
            if (currentGrid[r].every(cell => cell !== null)) rowsToClear.push(r);
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

            // Mark cells for animation
            const cellsToAnim: string[] = [];
            rowsToClear.forEach(r => {
                for (let c = 0; c < 8; c++) cellsToAnim.push(`${r}-${c}`);
            });
            colsToClear.forEach(c => {
                for (let r = 0; r < 8; r++) cellsToAnim.push(`${r}-${c}`);
            });
            setClearingCells(cellsToAnim);

            // Wait for animation then clear
            setTimeout(() => {
                const points = (totalLines * 100) * newCombo;
                setScore(prev => prev + points);

                rowsToClear.forEach(r => {
                    for (let c = 0; c < 8; c++) currentGrid[r][c] = null;
                });
                colsToClear.forEach(c => {
                    for (let r = 0; r < 8; r++) currentGrid[r][c] = null;
                });

                setGrid([...currentGrid]); // Trigger re-render
                setClearingCells([]);
            }, 400); // 400ms delay matches CSS animation
        } else {
            setCombo(0);
            setScore(prev => prev + 10);
            setGrid(currentGrid);
        }
    };

    return (
        <div className="game-container puzzle-mode" style={{ touchAction: 'none' }}>
            {/* Prevent browser gestures while playing */}

            {isGameOver && (
                <div className="result-overlay">
                    <div className="result-card lose">
                        <h1 className="result-title neon-text-red">GAME OVER</h1>
                        <div className="final-score">
                            <div className="score-box"><span className="label">SCORE</span><span className="value">{score}</span></div>
                        </div>
                        <button onClick={() => window.location.reload()} className="rematch-btn neon-btn">Try Again</button>
                    </div>
                </div>
            )}

            <div className="scoreboard glass-panel">
                <div className="score-box" style={{ alignItems: 'flex-start' }}>
                    <span className="label">SCORE</span>
                    <span className="value neon-text">{score}</span>
                </div>
                {combo > 1 && <div className="combo-badge animate-pulse">{combo}x COMBO!</div>}
                <button onClick={onBack} className="leave-btn">Exit</button>
            </div>

            <div className="board-wrapper glass-panel">
                <div className="board puzzle-board" ref={boardRef}>
                    {grid.map((row, r) => row.map((cell, c) => {
                        const cellKey = `${r}-${c}`;
                        const isGhost = ghostCells.includes(cellKey);
                        const isClearing = clearingCells.includes(cellKey);

                        return (
                            <div
                                key={cellKey}
                                className={`cell puzzle-cell ${isGhost ? 'ghost-active' : ''} ${isClearing ? 'clearing' : ''}`}
                                style={cell ? { backgroundColor: cell, boxShadow: `0 0 8px ${cell}` } : {}}
                            >
                                {isGhost && <div className="ghost-overlay" />}
                            </div>
                        );
                    }))}
                </div>
            </div>

            <div className="hand-container">
                {hand.map((shape, idx) => {
                    // Hide original if dragging
                    const isDragging = dragState?.shapeIdx === idx;
                    return (
                        <div
                            key={idx}
                            className={`shape-item ${shape === null ? 'used' : ''} ${isDragging ? 'invisible' : ''}`}
                            onPointerDown={(e) => handlePointerDown(e, idx)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp} // Handle interruption
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
                                            style={{
                                                backgroundColor: val ? shape.color : 'transparent',
                                                boxShadow: val ? `0 0 5px ${shape.color}` : 'none'
                                            }}
                                        />
                                    )))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Draggable Portal / Overlay */}
            {dragState && hand[dragState.shapeIdx] && (
                <div
                    className="drag-preview"
                    style={{
                        left: dragState.currentX,
                        top: dragState.currentY - 60, // Offset to see under finger
                    }}
                >
                    <div
                        className="mini-grid"
                        style={{
                            gridTemplateColumns: `repeat(${hand[dragState.shapeIdx]!.matrix[0].length}, 1fr)`,
                            // Scale up slightly while dragging
                            transform: 'scale(1.5)',
                        }}
                    >
                        {hand[dragState.shapeIdx]!.matrix.map((row, r) => row.map((val, c) => (
                            <div
                                key={`${r}-${c}`}
                                className="mini-cell"
                                style={{
                                    backgroundColor: val ? hand[dragState.shapeIdx]!.color : 'transparent',
                                    boxShadow: val ? `0 0 10px ${hand[dragState.shapeIdx]!.color}` : 'none',
                                    width: '20px', height: '20px'
                                }}
                            />
                        )))}
                    </div>
                </div>
            )}

            <div className="instructions">
                Drag blocks to grid
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
                    <h1 className="title neon-text">Game Menu</h1>
                    <div className="menu-buttons">
                        <button onClick={() => setGameMode(GameMode.OTHELLO)} className="menu-btn othello-btn glass-panel">
                            <span className="icon">⚫⚪</span>
                            <div className="text">
                                <span className="main neon-text-white">Online Othello</span>
                                <span className="sub">PVP Strategy</span>
                            </div>
                        </button>
                        <button onClick={() => setGameMode(GameMode.BLOCK_PUZZLE)} className="menu-btn puzzle-btn glass-panel">
                            <span className="icon">🧩</span>
                            <div className="text">
                                <span className="main neon-text-white">Block Puzzle</span>
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