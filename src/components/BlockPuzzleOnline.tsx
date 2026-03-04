import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import { THEME_PALETTES, type ShapeDef, type ColorKey } from '../constants.js';
import './BlockPuzzleGame.css'; // ← ソロモードのCSSをそのまま使います！

interface BlockPuzzleOnlineProps {
    onBack: () => void;
    theme: string;
}

type GameStatus = 'LOBBY' | 'WAITING' | 'PLAYING' | 'FINISHED' | 'ABORTED';

// ソロモードと同じ操作感にするための設定
const DRAG_SENSITIVITY = 1.5;
const TOUCH_OFFSET_Y = 100;
const BOARD_SIZE = 10; // マルチプレイは10x10

const BlockPuzzleOnline: React.FC<BlockPuzzleOnlineProps> = ({ onBack, theme }) => {
    const [socket] = useState(() => io());
    const [status, setStatus] = useState<GameStatus>('LOBBY');
    const [roomId, setRoomId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [myColor, setMyColor] = useState<string>('');
    const [board, setBoard] = useState<(string | null)[][]>(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)));
    const [turn, setTurn] = useState<string>('');
    const [allHands, setAllHands] = useState<{ black: ShapeDef[], white: ShapeDef[] } | null>(null);

    const myHand = useMemo(() => {
        if (!allHands || !myColor) return [];
        return allHands[myColor as 'black' | 'white'] || [];
    }, [allHands, myColor]);

    const opponentHand = useMemo(() => {
        if (!allHands || !myColor) return [];
        return allHands[myColor === 'black' ? 'white' : 'black'] || [];
    }, [allHands, myColor]);

    const [scores, setScores] = useState<{ black: number, white: number }>({ black: 0, white: 0 });
    const [winner, setWinner] = useState<string | null>(null);
    const [winReason, setWinReason] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');

    // ドラッグ状態管理（ソロモードから移植）
    const [dragState, setDragState] = useState<{
        shapeIdx: number; startX: number; startY: number; currentX: number; currentY: number;
        startPointerX: number; startPointerY: number; hoverRow: number | null; hoverCol: number | null; boardCellSize: number;
    } | null>(null);

    const boardRef = useRef<HTMLDivElement>(null);
    const boardMetrics = useRef<{ left: number, top: number, width: number, height: number, cellSize: number } | null>(null);

    const colors = useMemo(() => THEME_PALETTES[theme as keyof typeof THEME_PALETTES] || THEME_PALETTES['neon'], [theme]);

    useEffect(() => {
        socket.connect();

        socket.on('connect', () => {
            console.log('Connected to server');
        });

        socket.on('init_puzzle_game', ({ color, roomId }) => {
            setMyColor(color);
            setRoomId(roomId);
            setStatus('WAITING');
            setErrorMsg('');
        });

        socket.on('waiting_opponent', () => {
            setStatus('WAITING');
        });

        socket.on('puzzle_start', ({ board, turn, hands, scores }) => {
            setBoard(board);
            setTurn(turn);
            setScores(scores);
            setAllHands(hands);
            setStatus('PLAYING');
        });

        socket.on('update_puzzle_state', ({ board, turn, hands, scores }) => {
            setBoard(board);
            setTurn(turn);
            setScores(scores);
            setAllHands(hands);
        });

        socket.on('puzzle_game_over', ({ winner, reason, board, scores }) => {
            setBoard(board);
            setScores(scores);
            setWinner(winner);
            setWinReason(reason);
            setStatus('FINISHED');
        });

        socket.on('player_left', () => {
            setStatus('ABORTED');
            setErrorMsg('Opponent disconnected.');
        });

        socket.on('error_message', (msg) => {
            setErrorMsg(msg);
        });

        return () => {
            socket.off('connect');
            socket.off('init_puzzle_game');
            socket.off('waiting_opponent');
            socket.off('puzzle_start');
            socket.off('update_puzzle_state');
            socket.off('puzzle_game_over');
            socket.off('player_left');
            socket.off('error_message');
            socket.disconnect();
        };
    }, [socket]);

    const handleJoin = () => {
        if (!roomId || !playerName) {
            setErrorMsg('Please enter Room ID and Name');
            return;
        }
        socket.emit('join_puzzle_room', { roomId, playerName });
    };

    const canPlace = useCallback((currentGrid: (string | null)[][], matrix: number[][], r: number, c: number) => {
        const rows = matrix.length;
        const cols = matrix[0].length;
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                if (matrix[i][j] === 1) {
                    const nr = r + i;
                    const nc = c + j;
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) return false;
                    if (currentGrid[nr][nc] !== null) return false;
                }
            }
        }
        return true;
    }, []);

    const attemptPlace = useCallback((r: number, c: number, shape: ShapeDef, index: number) => {
        if (canPlace(board, shape.matrix, r, c)) {
            socket.emit('puzzle_move', { roomId, shapeIndex: index, row: r, col: c });
        }
    }, [board, canPlace, roomId, socket]);

    // --- ここからソロモードと同じ操作性のドラッグロジック ---
    const handlePointerDown = (e: React.PointerEvent, idx: number) => {
        if (status !== 'PLAYING' || turn !== myColor || !myHand[idx]) return;

        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);

        let currentCellSize = 30; // デフォルト値
        if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            currentCellSize = rect.width / BOARD_SIZE;
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
        const shape = myHand[shapeIdx];

        const deltaX = (e.clientX - startPointerX) * DRAG_SENSITIVITY;
        const deltaY = (e.clientY - startPointerY) * DRAG_SENSITIVITY;
        const currentX = startX + deltaX;
        const currentY = startY + deltaY;

        let bestRow: number | null = null;
        let bestCol: number | null = null;

        if (shape && boardMetrics.current) {
            const { left, top, cellSize } = boardMetrics.current;
            const shapeWidthPx = shape.matrix[0].length * cellSize;
            const shapeHeightPx = shape.matrix.length * cellSize;
            const visualTopLeftX = currentX - (shapeWidthPx / 2);
            const visualTopLeftY = currentY - TOUCH_OFFSET_Y - (shapeHeightPx / 2);

            let minDistance = Infinity;
            const SNAP_THRESHOLD = cellSize * 2.5;

            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (canPlace(board, shape.matrix, r, c)) {
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
        }
        setDragState(prev => prev ? { ...prev, currentX, currentY, hoverRow: bestRow, hoverCol: bestCol } : null);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState) return;
        const { shapeIdx, hoverRow, hoverCol } = dragState;
        const shape = myHand[shapeIdx];

        const target = e.currentTarget as HTMLElement;
        target.releasePointerCapture(e.pointerId);

        if (shape && hoverRow !== null && hoverCol !== null) {
            attemptPlace(hoverRow, hoverCol, shape, shapeIdx);
        }
        setDragState(null);
    };

    // どこに落ちるかのプレビュー（ゴースト）計算
    const ghostCells = useMemo(() => {
        if (!dragState || dragState.hoverRow === null || dragState.hoverCol === null) return [];
        const shape = myHand[dragState.shapeIdx];
        if (!shape) return [];
        const { hoverRow, hoverCol } = dragState;
        if (canPlace(board, shape.matrix, hoverRow, hoverCol)) {
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
    }, [dragState, board, myHand, canPlace]);
    // --- ドラッグロジックここまで ---

    // ★白・黒の代わりに、見やすい対戦カラーにする設定
    const getCellColor = (val: string | null) => {
        if (!val) return 'transparent';
        if (val === 'black') return '#4a90e2'; // P1: ブルー（青）
        if (val === 'white') return '#e94b3c'; // P2: レッド（赤）
        if (colors[val as ColorKey]) return colors[val as ColorKey];
        return val;
    };

    if (status === 'LOBBY') {
        return (
            <div className="lobby-container">
                <div className="lobby-card glass-panel">
                    <h1 className="title neon-text">Block Puzzle PvP</h1>
                    <div className="input-group">
                        <label>Room ID</label>
                        <input value={roomId} onChange={e => setRoomId(e.target.value)} placeholder="Enter Room ID" />
                    </div>
                    <div className="input-group" style={{ marginTop: '1rem' }}>
                        <label>Your Name</label>
                        <input value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="Enter Name" />
                    </div>
                    {errorMsg && <div className="error-msg">{errorMsg}</div>}
                    <button onClick={handleJoin} className="join-btn neon-btn" style={{ marginTop: '2rem' }}>
                        Join Game
                    </button>
                    <button onClick={onBack} className="back-link" style={{ marginTop: '1rem', width: '100%', textAlign: 'center' }}>
                        Back to Menu
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="game-container puzzle-mode" style={{ touchAction: 'none' }}>
            <div className="scoreboard glass-panel puzzle-header-layout">
                <div className="score-box left-align">
                    <span className="label" style={{ color: getCellColor(myColor) }}>YOU</span>
                    <span className="puzzle-score">{scores[myColor as 'black' | 'white'] || 0}</span>
                </div>
                <div className="combo-center-area">
                    {status === 'WAITING' ? (
                        <span className="neon-text" style={{ fontSize: '0.8rem' }}>WAITING...</span>
                    ) : (
                        <span className="neon-text" style={{ fontSize: '1rem' }}>
                            {turn === myColor ? "YOUR TURN" : "OPPONENT'S TURN"}
                        </span>
                    )}
                </div>
                <div className="score-box right-align">
                    <div style={{ textAlign: 'right' }}>
                        <span className="label" style={{ color: getCellColor(myColor === 'black' ? 'white' : 'black') }}>OPPONENT</span>
                        <div className="puzzle-score">{scores[myColor === 'black' ? 'white' : 'black'] || 0}</div>
                    </div>
                </div>
            </div>

            <div className="board-wrapper glass-panel">
                <div className="board puzzle-board" ref={boardRef} style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}>
                    {board.map((row, r) => (
                        row.map((cell, c) => {
                            const cellKey = `${r}-${c}`;
                            const isGhost = ghostCells.includes(cellKey);
                            return (
                                <div
                                    key={cellKey}
                                    className={`cell puzzle-cell ${isGhost ? 'ghost-active' : ''}`}
                                    style={cell ? { backgroundColor: getCellColor(cell) } : {}}
                                >
                                    {isGhost && <div className="ghost-overlay" style={{ backgroundColor: getCellColor(myColor), opacity: 0.5 }} />}
                                </div>
                            );
                        })
                    ))}
                </div>
            </div>

            {/* 相手の手札（相手の色で表示） */}
            <div style={{ width: '100%', maxWidth: '500px', marginBottom: '10px', opacity: 0.8 }}>
                <div style={{ fontSize: '0.7rem', color: '#fff', marginBottom: '5px', textAlign: 'center' }}>Opponent's Hand</div>
                <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
                    {opponentHand.map((shape, i) => (
                        <div key={i} style={{ transform: 'scale(0.5)' }}>
                            {shape ? (
                                <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)` }}>
                                    {shape.matrix.map((row, r) => row.map((val, c) => (
                                        <div key={`${r}-${c}`} className="mini-cell"
                                            style={{ backgroundColor: val ? getCellColor(myColor === 'black' ? 'white' : 'black') : 'transparent' }}
                                        />
                                    )))}
                                </div>
                            ) : <div style={{ width: 40, height: 40 }} />}
                        </div>
                    ))}
                </div>
            </div>

            {/* 自分の手札（ドラッグ操作可能） */}
            <div className="hand-container">
                {myHand.map((shape, idx) => {
                    const isDragging = dragState?.shapeIdx === idx;
                    const color = shape ? colors[shape.colorKey] : 'transparent';
                    return (
                        <div
                            key={idx}
                            className={`shape-item ${!shape ? 'used' : ''} ${isDragging ? 'invisible' : ''}`}
                            onPointerDown={(e) => handlePointerDown(e, idx)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                        >
                            {shape && (
                                <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)` }}>
                                    {shape.matrix.map((row, r) => row.map((val, c) => (
                                        <div key={`${r}-${c}`} className="mini-cell" style={{
                                            backgroundColor: val ? color : 'transparent',
                                            border: val ? 'var(--cell-border)' : 'none'
                                        }} />
                                    )))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ドラッグ中のプレビュー（指の上にずらして表示） */}
            {dragState && myHand[dragState.shapeIdx] && (
                <div className="drag-preview" style={{ left: dragState.currentX, top: dragState.currentY - TOUCH_OFFSET_Y, transform: 'translate(-50%, -50%)' }}>
                    <div className="mini-grid" style={{
                        gridTemplateColumns: `repeat(${myHand[dragState.shapeIdx]!.matrix[0].length}, 1fr)`,
                        width: `${myHand[dragState.shapeIdx]!.matrix[0].length * dragState.boardCellSize}px`,
                    }}>
                        {myHand[dragState.shapeIdx]!.matrix.map((row, r) => row.map((val, c) => (
                            <div key={`${r}-${c}`} className="mini-cell" style={{
                                backgroundColor: val ? colors[myHand[dragState.shapeIdx]!.colorKey] : 'transparent',
                                width: `${dragState.boardCellSize}px`, height: `${dragState.boardCellSize}px`,
                                border: val ? 'var(--cell-border)' : 'none'
                            }} />
                        )))}
                    </div>
                </div>
            )}

            {/* リザルト画面 */}
            {(status === 'FINISHED' || status === 'ABORTED') && (
                <div className="result-overlay">
                    <div className={`result-card ${winner === myColor ? 'win' : 'lose'}`}>
                        <h2 className="result-title neon-text">
                            {status === 'ABORTED' ? 'ABORTED' : (winner === myColor ? 'YOU WIN!' : 'YOU LOSE')}
                        </h2>
                        <p>{winReason === 'no_moves' ? (winner === myColor ? "Opponent has no moves!" : "No moves left!") : errorMsg}</p>
                        <div style={{ fontSize: '1.5rem', margin: '1rem 0' }}>
                            {scores.black} - {scores.white}
                        </div>
                        <button onClick={onBack} className="rematch-btn neon-btn">
                            Back to Menu
                        </button>
                    </div>
                </div>
            )}

            <div className="controls">
                <button onClick={onBack} className="leave-btn">Leave Game</button>
            </div>
        </div>
    );
};

export default BlockPuzzleOnline;