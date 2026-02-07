
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

// ==========================================
// SHARED TYPES & THEMES
// ==========================================
export type PlayerColor = 'black' | 'white';
export type CellState = PlayerColor | null;
export type BoardState = CellState[][];

type ThemeType = 'neon' | 'pastel' | 'misty' | 'muted-blue' | 'muted-purple';

// Color Palettes for Block Puzzle
// Extended with new themes mapping
const THEME_PALETTES = {
    neon: {
        green: '#34d399', blue: '#60a5fa', indigo: '#818cf8', yellow: '#facc15',
        red: '#f87171', purple: '#c084fc', lime: '#a3e635', orange: '#fb923c',
        pink: '#e879f9', teal: '#2dd4bf', rose: '#f43f5e'
    },
    pastel: {
        green: '#bbf7d0', blue: '#bfdbfe', indigo: '#c7d2fe', yellow: '#fef08a',
        red: '#fecaca', purple: '#e9d5ff', lime: '#d9f99d', orange: '#fed7aa',
        pink: '#fbcfe8', teal: '#99f6e4', rose: '#fecdd3'
    },
    misty: {
        green: '#84a59d', blue: '#8da9c4', indigo: '#6b705c', yellow: '#e9c46a',
        red: '#e76f51', purple: '#a5a58d', lime: '#cb997e', orange: '#f4a261',
        pink: '#b7b7a4', teal: '#264653', rose: '#ddbea9'
    },
    'muted-blue': {
        green: '#7393B3', blue: '#5F9EA0', indigo: '#4682B4', yellow: '#B0C4DE',
        red: '#CD5C5C', purple: '#778899', lime: '#8FBC8F', orange: '#E9967A',
        pink: '#D8BFD8', teal: '#5F9EA0', rose: '#BC8F8F'
    },
    'muted-purple': {
        green: '#8FBC8F', blue: '#B0C4DE', indigo: '#9370DB', yellow: '#EEE8AA',
        red: '#DB7093', purple: '#BA55D3', lime: '#98FB98', orange: '#FFA07A',
        pink: '#DDA0DD', teal: '#66CDAA', rose: '#FFB6C1'
    }
};

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

const DRAG_SENSITIVITY = 1.5;
const TOUCH_OFFSET_Y = 100;

const BASE_SCORES: { [key: number]: number } = {
    1: 10, 2: 20, 3: 60, 4: 120, 5: 200, 6: 300, 7: 420, 8: 560
};

type ColorKey = keyof typeof THEME_PALETTES.neon;

type ShapeDef = {
    id: string;
    matrix: number[][];
    colorKey: ColorKey; // Changed from hex string to key
    difficulty: number;
};

// Updated Shapes using Color Keys
const PUZZLE_SHAPES: ShapeDef[] = [
    { id: 'I1', matrix: [[1]], colorKey: 'rose', difficulty: 1 },
    { id: 'I2', matrix: [[1, 1]], colorKey: 'green', difficulty: 1 },
    { id: 'I2_V', matrix: [[1], [1]], colorKey: 'green', difficulty: 1 },
    { id: 'I3', matrix: [[1, 1, 1]], colorKey: 'blue', difficulty: 2 },
    { id: 'I3_V', matrix: [[1], [1], [1]], colorKey: 'blue', difficulty: 2 },
    { id: 'I4', matrix: [[1, 1, 1, 1]], colorKey: 'indigo', difficulty: 2 },
    { id: 'I4_V', matrix: [[1], [1], [1], [1]], colorKey: 'indigo', difficulty: 2 },
    { id: 'I5', matrix: [[1, 1, 1, 1, 1]], colorKey: 'yellow', difficulty: 3 },
    { id: 'I5_V', matrix: [[1], [1], [1], [1], [1]], colorKey: 'yellow', difficulty: 3 },
    { id: 'SQR2', matrix: [[1, 1], [1, 1]], colorKey: 'red', difficulty: 2 },
    { id: 'SQR3', matrix: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], colorKey: 'purple', difficulty: 3 },
    { id: 'RECT2x3', matrix: [[1, 1, 1], [1, 1, 1]], colorKey: 'lime', difficulty: 3 },
    { id: 'RECT3x2', matrix: [[1, 1], [1, 1], [1, 1]], colorKey: 'lime', difficulty: 3 },
    { id: 'L3', matrix: [[1, 0], [1, 1]], colorKey: 'purple', difficulty: 1 },
    { id: 'L3_R', matrix: [[0, 1], [1, 1]], colorKey: 'purple', difficulty: 1 },
    { id: 'L3_V', matrix: [[1, 1], [1, 0]], colorKey: 'purple', difficulty: 1 },
    { id: 'L3_VR', matrix: [[1, 1], [0, 1]], colorKey: 'purple', difficulty: 1 },
    { id: 'L5', matrix: [[1, 0, 0], [1, 0, 0], [1, 1, 1]], colorKey: 'orange', difficulty: 3 },
    { id: 'L5_R', matrix: [[0, 0, 1], [0, 0, 1], [1, 1, 1]], colorKey: 'orange', difficulty: 3 },
    { id: 'T3', matrix: [[1, 1, 1], [0, 1, 0]], colorKey: 'pink', difficulty: 2 },
    { id: 'T3_D', matrix: [[0, 1, 0], [1, 1, 1]], colorKey: 'pink', difficulty: 2 },
    { id: 'Z3', matrix: [[1, 1, 0], [0, 1, 1]], colorKey: 'teal', difficulty: 2 },
    { id: 'S3', matrix: [[0, 1, 1], [1, 1, 0]], colorKey: 'teal', difficulty: 2 },
];

// Helper: Smart Generation
const getSmartShapes = (grid: (string | null)[][], count: number) => {
    let filledCount = 0;
    grid.forEach(r => r.forEach(c => { if (c) filledCount++; }));
    const density = filledCount / 64;

    const shapes = [];
    for (let i = 0; i < count; i++) {
        let pool = PUZZLE_SHAPES;
        if (density > 0.4 && i < 2) pool = PUZZLE_SHAPES.filter(s => s.difficulty <= 2);
        if (density > 0.7 && i === 0) pool = PUZZLE_SHAPES.filter(s => s.difficulty === 1);
        const rand = pool[Math.floor(Math.random() * pool.length)];
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

    if (status === OthelloStatus.LOBBY) {
        return (
            <div className="lobby-container">
                <div className="lobby-card">
                    <button onClick={onBack} className="back-link">← Back to Menu</button>
                    <h1 className="title neon-text">Othello Lobby</h1>
                    <div className="input-group">
                        <label>Room ID</label>
                        <input type="text" value={inputRoomID} onChange={(e) => setInputRoomID(e.target.value)} placeholder="Enter room name..." onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()} />
                    </div>
                    <button onClick={handleJoinRoom} className="join-btn neon-btn">Join / Create Room</button>
                    {error && <div className="error-msg">{error}</div>}
                </div>
            </div>
        );
    }

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
            <div className="scoreboard glass-panel othello-header">
                <div className={`player-info ${turn === 'black' ? 'active-turn' : ''}`}>
                    <div className="score-indicator black"></div>
                    <div className="score-text"><span>BLACK {myColor === 'black' && <span className="you-tag">YOU</span>}</span><span className="score-value">{scores.black}</span></div>
                </div>
                <div className="game-status">
                    <div className="room-id">Room: {roomID}</div>
                    <div className={`status-badge ${myColor === turn ? 'my-turn' : ''}`}>
                        {status === OthelloStatus.WAITING ? 'Waiting...' : status === OthelloStatus.FINISHED ? 'GAME OVER' : status === OthelloStatus.ABORTED ? 'Left' : myColor === turn ? 'YOUR TURN' : "OPPONENT"}
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
            <div className="controls"><button onClick={onBack} className="leave-btn">Exit to Menu</button></div>
        </div>
    );
};

// ==========================================
// COMPONENTS: BLOCK PUZZLE
// ==========================================

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

const getPotentialClears = (grid: (string | null)[][], matrix: number[][], r: number, c: number, color: string) => {
    const tempGrid = grid.map(row => [...row]);
    const rows = matrix.length;
    const cols = matrix[0].length;
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (matrix[i][j] === 1) tempGrid[r + i][c + j] = color;
        }
    }
    const rowsToClear: number[] = [];
    const colsToClear: number[] = [];
    for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr].every(cell => cell !== null)) rowsToClear.push(rr); }
    for (let cc = 0; cc < 8; cc++) {
        let full = true;
        for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr][cc] === null) { full = false; break; } }
        if (full) colsToClear.push(cc);
    }
    return { rows: rowsToClear, cols: colsToClear };
};

const BlockPuzzleGame: React.FC<{ onBack: () => void; theme: ThemeType }> = ({ onBack, theme }) => {
    const [grid, setGrid] = useState<(string | null)[][]>(Array(8).fill(null).map(() => Array(8).fill(null)));
    const [clearingCells, setClearingCells] = useState<string[]>([]);
    const [hand, setHand] = useState<(ShapeDef | null)[]>(() => getSmartShapes(Array(8).fill(Array(8).fill(null)), 3));
    const [score, setScore] = useState(0);
    const [combo, setCombo] = useState(0);
    const [movesSinceClear, setMovesSinceClear] = useState(0);
    const [comboText, setComboText] = useState<{ main: string, sub: string } | null>(null);
    const [isShaking, setIsShaking] = useState(false);

    const [highlightLines, setHighlightLines] = useState<{ rows: number[], cols: number[] }>({ rows: [], cols: [] });
    const [floatingTexts, setFloatingTexts] = useState<{ id: number, x: number, y: number, text: string }[]>([]);
    const floatingTextId = useRef(0);

    const [dragState, setDragState] = useState<{
        shapeIdx: number; startX: number; startY: number; currentX: number; currentY: number;
        startPointerX: number; startPointerY: number; hoverRow: number | null; hoverCol: number | null; boardCellSize: number;
    } | null>(null);

    const boardRef = useRef<HTMLDivElement>(null);
    const boardMetrics = useRef<{ left: number, top: number, width: number, height: number, cellSize: number } | null>(null);

    const getThemeColor = (key: ColorKey) => THEME_PALETTES[theme][key];

    useEffect(() => {
        if (hand.length > 0 && hand.every(h => h === null) && clearingCells.length === 0) {
            const timer = setTimeout(() => {
                setHand(getSmartShapes(grid, 3));
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [hand, clearingCells.length, grid]);

    const isGameOver = useMemo(() => {
        if (hand.every(h => h === null)) return false;
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

    const addFloatingText = (x: number, y: number, text: string) => {
        const id = floatingTextId.current++;
        setFloatingTexts(prev => [...prev, { id, x, y, text }]);
        setTimeout(() => {
            setFloatingTexts(prev => prev.filter(ft => ft.id !== id));
        }, 1000);
    };

    const handlePointerDown = (e: React.PointerEvent, idx: number) => {
        if (isGameOver || hand[idx] === null) return;
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);

        let currentCellSize = 40;
        if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            currentCellSize = rect.width / 8;
            boardMetrics.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, cellSize: currentCellSize };
        }

        setDragState({
            shapeIdx: idx,
            startX: e.clientX, startY: e.clientY,
            startPointerX: e.clientX, startPointerY: e.clientY,
            currentX: e.clientX, currentY: e.clientY,
            hoverRow: null, hoverCol: null,
            boardCellSize: currentCellSize
        });
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!dragState) return;
        e.preventDefault();
        const { shapeIdx, startX, startY, startPointerX, startPointerY } = dragState;
        const shape = hand[shapeIdx];

        const deltaX = (e.clientX - startPointerX) * DRAG_SENSITIVITY;
        const deltaY = (e.clientY - startPointerY) * DRAG_SENSITIVITY;
        const currentX = startX + deltaX;
        const currentY = startY + deltaY;

        let bestRow: number | null = null;
        let bestCol: number | null = null;
        let hRows: number[] = [];
        let hCols: number[] = [];

        if (shape && boardMetrics.current) {
            const { left, top, cellSize } = boardMetrics.current;
            const shapeWidthPx = shape.matrix[0].length * cellSize;
            const shapeHeightPx = shape.matrix.length * cellSize;
            const visualTopLeftX = currentX - (shapeWidthPx / 2);
            const visualTopLeftY = currentY - TOUCH_OFFSET_Y - (shapeHeightPx / 2);

            let minDistance = Infinity;
            const SNAP_THRESHOLD = cellSize * 2.5;

            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (canPlace(grid, shape.matrix, r, c)) {
                        const targetX = left + (c * cellSize);
                        const targetY = top + (r * cellSize);
                        const dist = Math.hypot(targetX - visualTopLeftX, targetY - visualTopLeftY);

                        if (dist < minDistance && dist < SNAP_THRESHOLD) {
                            minDistance = dist;
                            bestRow = r;
                            bestCol = c;
                        }
                    }
                }
            }

            if (bestRow !== null && bestCol !== null) {
                const color = getThemeColor(shape.colorKey);
                const clears = getPotentialClears(grid, shape.matrix, bestRow, bestCol, color);
                hRows = clears.rows;
                hCols = clears.cols;
            }
        }

        setHighlightLines({ rows: hRows, cols: hCols });
        setDragState(prev => prev ? { ...prev, currentX, currentY, hoverRow: bestRow, hoverCol: bestCol } : null);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState) return;
        const { shapeIdx, hoverRow, hoverCol, currentX, currentY } = dragState;
        const shape = hand[shapeIdx];

        const target = e.currentTarget as HTMLElement;
        target.releasePointerCapture(e.pointerId);

        setHighlightLines({ rows: [], cols: [] });

        if (shape && hoverRow !== null && hoverCol !== null) {
            if (canPlace(grid, shape.matrix, hoverRow, hoverCol)) {
                const color = getThemeColor(shape.colorKey);
                let placementScore = 0;
                shape.matrix.forEach(row => row.forEach(val => { if (val === 1) placementScore++; }));

                const newGrid = grid.map(row => [...row]);
                const rows = shape.matrix.length;
                const cols = shape.matrix[0].length;
                for (let i = 0; i < rows; i++) {
                    for (let j = 0; j < cols; j++) {
                        if (shape.matrix[i][j] === 1) {
                            newGrid[hoverRow + i][hoverCol + j] = color;
                        }
                    }
                }

                const rowsToClear: number[] = [];
                const colsToClear: number[] = [];
                for (let r = 0; r < 8; r++) { if (newGrid[r].every(cell => cell !== null)) rowsToClear.push(r); }
                for (let c = 0; c < 8; c++) {
                    let full = true;
                    for (let r = 0; r < 8; r++) { if (newGrid[r][c] === null) { full = false; break; } }
                    if (full) colsToClear.push(c);
                }
                const totalLines = rowsToClear.length + colsToClear.length;

                let moveTotalScore = placementScore;
                if (totalLines > 0) {
                    const nextCombo = combo + 1;
                    const baseScore = BASE_SCORES[totalLines] || (totalLines * 60);
                    const clearScore = baseScore * (nextCombo + 1);
                    moveTotalScore += clearScore;
                }

                addFloatingText(currentX, currentY - TOUCH_OFFSET_Y, `+${moveTotalScore}`);
                setScore(prev => prev + placementScore);

                const newHand = [...hand];
                newHand[shapeIdx] = null;
                setHand(newHand);
                setGrid(newGrid);

                checkLinesAndScore(newGrid);
            }
        }
        setDragState(null);
    };

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
        for (let r = 0; r < 8; r++) { if (currentGrid[r].every(cell => cell !== null)) rowsToClear.push(r); }
        for (let c = 0; c < 8; c++) {
            let full = true;
            for (let r = 0; r < 8; r++) { if (currentGrid[r][c] === null) { full = false; break; } }
            if (full) colsToClear.push(c);
        }

        const totalLines = rowsToClear.length + colsToClear.length;

        if (totalLines > 0) {
            setMovesSinceClear(0);
            const newCombo = combo + 1;
            setCombo(newCombo);

            const baseScore = BASE_SCORES[totalLines] || (totalLines * 60);
            const points = baseScore * (newCombo + 1);

            if (newCombo >= 2) {
                let mainText = "Great!";
                if (newCombo >= 4) mainText = "Amazing!";
                if (newCombo >= 6) mainText = "Perfect!";
                if (totalLines >= 3) mainText = "Incredible!";
                setComboText({ main: mainText, sub: `Combo x${newCombo}` });
                setTimeout(() => setComboText(null), 1500);
            }

            setIsShaking(true);
            setTimeout(() => setIsShaking(false), 500);

            const cellsToAnim: string[] = [];
            rowsToClear.forEach(r => { for (let c = 0; c < 8; c++) cellsToAnim.push(`${r}-${c}`); });
            colsToClear.forEach(c => { for (let r = 0; r < 8; r++) cellsToAnim.push(`${r}-${c}`); });
            setClearingCells(cellsToAnim);

            setTimeout(() => {
                setScore(prev => prev + points);
                const nextGrid = currentGrid.map(row => [...row]);
                rowsToClear.forEach(r => { for (let c = 0; c < 8; c++) nextGrid[r][c] = null; });
                colsToClear.forEach(c => { for (let r = 0; r < 8; r++) nextGrid[r][c] = null; });
                setGrid(nextGrid);
                setClearingCells([]);
            }, 400);
        } else {
            const newMovesSinceClear = movesSinceClear + 1;
            setMovesSinceClear(newMovesSinceClear);
            if (newMovesSinceClear > 2) {
                setCombo(0);
                setMovesSinceClear(0);
            }
        }
    };

    return (
        <div className="game-container puzzle-mode" style={{ touchAction: 'none' }}>
            {comboText && <div className="combo-popup"><div className="combo-text">{comboText.main}</div><div className="combo-sub">{comboText.sub}</div></div>}

            {floatingTexts.map(ft => (
                <div key={ft.id} className="floating-text" style={{ left: ft.x, top: ft.y }}>
                    {ft.text}
                </div>
            ))}

            {isGameOver && (
                <div className="result-overlay">
                    <div className="result-card lose">
                        <h1 className="result-title neon-text-red">GAME OVER</h1>
                        <div className="final-score"><div className="score-box"><span className="label">SCORE</span><span className="value">{score}</span></div></div>
                        <button onClick={() => window.location.reload()} className="rematch-btn neon-btn">Try Again</button>
                    </div>
                </div>
            )}

            <div className="scoreboard glass-panel puzzle-header-layout">
                <div className="score-box left-align">
                    <span className="label">SCORE</span>
                    <span className={`value puzzle-score ${combo > 0 ? 'combo-active' : ''}`}>{score}</span>
                </div>

                <div className="combo-center-area">
                    {combo > 0 ? (
                        <div className="combo-badge-container-static">
                            <div className="combo-badge animate-pulse">{combo}x COMBO</div>
                            {movesSinceClear > 0 && <div className="combo-warning">{movesSinceClear === 1 ? "⚠️" : "⚠️⚠️"}</div>}
                        </div>
                    ) : (
                        <span className="game-title-small">BLOCK PUZZLE</span>
                    )}
                </div>

                <div className="right-align">
                    <button onClick={onBack} className="leave-btn">Exit</button>
                </div>
            </div>

            <div className={`board-wrapper glass-panel ${isShaking ? 'shake-effect' : ''}`}>
                <div className="board puzzle-board" ref={boardRef}>
                    {grid.map((row, r) => row.map((cell, c) => {
                        const cellKey = `${r}-${c}`;
                        const isGhost = ghostCells.includes(cellKey);
                        const isClearing = clearingCells.includes(cellKey);
                        const isHighlightRow = highlightLines.rows.includes(r);
                        const isHighlightCol = highlightLines.cols.includes(c);

                        return (
                            <div
                                key={cellKey}
                                className={`cell puzzle-cell ${isGhost ? 'ghost-active' : ''} ${isClearing ? 'clearing' : ''}`}
                                style={cell ? { backgroundColor: cell, boxShadow: `0 0 5px rgba(0,0,0,0.2)` } : {}}
                            >
                                {isGhost && <div className="ghost-overlay" />}
                                {(isHighlightRow || isHighlightCol) && <div className="potential-clear-overlay" />}
                            </div>
                        );
                    }))}
                </div>
            </div>

            <div className="hand-container">
                {hand.map((shape, idx) => {
                    const isDragging = dragState?.shapeIdx === idx;
                    const color = shape ? getThemeColor(shape.colorKey) : 'transparent';
                    return (
                        <div
                            key={idx}
                            className={`shape-item ${shape === null ? 'used' : ''} ${isDragging ? 'invisible' : ''}`}
                            onPointerDown={(e) => handlePointerDown(e, idx)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                        >
                            {shape && (
                                <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)` }}>
                                    {shape.matrix.map((row, r) => row.map((val, c) => (
                                        <div key={`${r}-${c}`} className="mini-cell" style={{ backgroundColor: val ? color : 'transparent' }} />
                                    )))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {dragState && hand[dragState.shapeIdx] && (
                <div className="drag-preview" style={{ left: dragState.currentX, top: dragState.currentY - TOUCH_OFFSET_Y, transform: 'translate(-50%, -50%)' }}>
                    <div className="mini-grid" style={{
                        gridTemplateColumns: `repeat(${hand[dragState.shapeIdx]!.matrix[0].length}, 1fr)`,
                        width: `${hand[dragState.shapeIdx]!.matrix[0].length * dragState.boardCellSize}px`,
                        gap: '2px'
                    }}>
                        {hand[dragState.shapeIdx]!.matrix.map((row, r) => row.map((val, c) => (
                            <div key={`${r}-${c}`} className="mini-cell" style={{
                                backgroundColor: val ? getThemeColor(hand[dragState.shapeIdx]!.colorKey) : 'transparent',
                                width: `${dragState.boardCellSize}px`, height: `${dragState.boardCellSize}px`, borderRadius: '4px'
                            }} />
                        )))}
                    </div>
                </div>
            )}
            <div className="instructions">Drag blocks to grid</div>
        </div>
    );
};

// ==========================================
// MAIN APP & MENU
// ==========================================

const App: React.FC = () => {
    const [gameMode, setGameMode] = useState<GameMode>(GameMode.MENU);
    const [theme, setTheme] = useState<ThemeType>('pastel');

    // Apply theme to body
    useEffect(() => {
        document.body.setAttribute('data-theme', theme);
    }, [theme]);

    const themes: ThemeType[] = ['neon', 'pastel', 'misty', 'muted-blue', 'muted-purple'];

    const getThemeGradient = (t: ThemeType) => {
        switch (t) {
            case 'neon': return 'linear-gradient(135deg, #000000, #10b981)';
            case 'pastel': return 'linear-gradient(135deg, #fff0f5, #f472b6)';
            case 'misty': return 'linear-gradient(135deg, #e0e1dd, #778da9)';
            case 'muted-blue': return 'linear-gradient(135deg, #d1d9e6, #5F9EA0)';
            case 'muted-purple': return 'linear-gradient(135deg, #e6e1e8, #9370DB)';
        }
        return '#fff';
    };

    if (gameMode === GameMode.MENU) {
        return (
            <div className="lobby-container">
                <div className="theme-selector-container glass-panel">
                    <span className="theme-label">THEME</span>
                    <div className="theme-options">
                        {themes.map(t => (
                            <button
                                key={t}
                                className={`theme-swatch ${theme === t ? 'active' : ''}`}
                                style={{ background: getThemeGradient(t) }}
                                onClick={() => setTheme(t)}
                                aria-label={`Select ${t} theme`}
                            />
                        ))}
                    </div>
                </div>

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
        return <BlockPuzzleGame onBack={() => setGameMode(GameMode.MENU)} theme={theme} />;
    }

    return null;
};

export default App;
