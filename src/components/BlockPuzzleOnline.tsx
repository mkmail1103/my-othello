import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import { THEME_PALETTES, type ShapeDef, type ColorKey } from '../constants';
import './BlockPuzzleGame.css';

const SOCKET_URL = 'http://localhost:3000';

interface BlockPuzzleOnlineProps {
    onBack: () => void;
    theme: string;
}

type GameStatus = 'LOBBY' | 'WAITING' | 'PLAYING' | 'FINISHED' | 'ABORTED';

const BlockPuzzleOnline: React.FC<BlockPuzzleOnlineProps> = ({ onBack, theme }) => {
    // Lazy initialization for socket
    const [socket] = useState(() => io(SOCKET_URL));
    const [status, setStatus] = useState<GameStatus>('LOBBY');
    const [roomId, setRoomId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [myColor, setMyColor] = useState<string>('');
    const [board, setBoard] = useState<(string | null)[][]>(Array(10).fill(null).map(() => Array(10).fill(null)));
    const [turn, setTurn] = useState<string>('');
    const [allHands, setAllHands] = useState<{ black: ShapeDef[], white: ShapeDef[] } | null>(null);

    // Derived state for hands
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

    // Dragging state
    const [draggingShape, setDraggingShape] = useState<{ shape: ShapeDef, index: number } | null>(null);
    const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
    const boardRef = useRef<HTMLDivElement>(null);

    // Theme colors
    const colors = useMemo(() => THEME_PALETTES[theme as keyof typeof THEME_PALETTES] || THEME_PALETTES['neon'], [theme]);

    useEffect(() => {
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

    useEffect(() => {
        if (allHands && myColor) {
            // Hand derivation is now handled by useMemo
        }
    }, [allHands, myColor]);


    const handleJoin = () => {
        if (!roomId || !playerName) {
            setErrorMsg('Please enter Room ID and Name');
            return;
        }
        socket.emit('join_puzzle_room', { roomId, playerName });
    };

    // Helper functions
    const canPlace = useCallback((currentGrid: (string | null)[][], matrix: number[][], r: number, c: number) => {
        const rows = matrix.length;
        const cols = matrix[0].length;
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                if (matrix[i][j] === 1) {
                    const nr = r + i;
                    const nc = c + j;
                    if (nr < 0 || nr >= 10 || nc < 0 || nc >= 10) return false;
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

    // Drag Logic
    const handleTouchStart = (e: React.TouchEvent | React.MouseEvent, shape: ShapeDef, index: number) => {
        if (status !== 'PLAYING' || turn !== myColor) return;

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

        setDraggingShape({ shape, index });
        setDragPos({ x: clientX, y: clientY });
    };

    const handleTouchMove = useCallback((e: TouchEvent | MouseEvent) => {
        if (!draggingShape) return;
        const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
        setDragPos({ x: clientX, y: clientY });
    }, [draggingShape]);

    const handleTouchEnd = useCallback(() => {
        if (!draggingShape) return;

        if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            const x = dragPos.x - rect.left;
            const y = dragPos.y - rect.top;

            const cellSize = rect.width / 10;

            const shapeWidth = draggingShape.shape.matrix[0].length * cellSize;
            const shapeHeight = draggingShape.shape.matrix.length * cellSize;

            const targetR = Math.round((y - shapeHeight / 2) / cellSize);
            const targetC = Math.round((x - shapeWidth / 2) / cellSize);

            attemptPlace(targetR, targetC, draggingShape.shape, draggingShape.index);
        }

        setDraggingShape(null);
    }, [draggingShape, dragPos, attemptPlace]);

    useEffect(() => {
        if (draggingShape) {
            window.addEventListener('touchmove', handleTouchMove, { passive: false });
            window.addEventListener('touchend', handleTouchEnd);
            window.addEventListener('mousemove', handleTouchMove);
            window.addEventListener('mouseup', handleTouchEnd);
        }
        return () => {
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
            window.removeEventListener('mousemove', handleTouchMove);
            window.removeEventListener('mouseup', handleTouchEnd);
        };
    }, [draggingShape, handleTouchMove, handleTouchEnd]);

    // Render Helpers
    const getCellColor = (val: string | null) => {
        if (!val) return 'transparent';
        if (val === 'black') return '#333'; // P1 Color
        if (val === 'white') return '#eee'; // P2 Color
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
                        <input
                            value={roomId}
                            onChange={e => setRoomId(e.target.value)}
                            placeholder="Enter Room ID"
                        />
                    </div>
                    <div className="input-group" style={{ marginTop: '1rem' }}>
                        <label>Your Name</label>
                        <input
                            value={playerName}
                            onChange={e => setPlayerName(e.target.value)}
                            placeholder="Enter Name"
                        />
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
        <div className="game-container">
            <div className="scoreboard glass-panel puzzle-header-layout">
                <div className="score-box left-align">
                    <span className="label">YOU ({myColor})</span>
                    <span className="puzzle-score">{scores[myColor as 'black' | 'white'] || 0}</span>
                </div>
                <div className="combo-center-area">
                    {status === 'WAITING' ? (
                        <span className="neon-text" style={{ fontSize: '0.8rem' }}>WAITING FOR OPPONENT...</span>
                    ) : (
                        <span className="neon-text" style={{ fontSize: '1rem' }}>
                            {turn === myColor ? "YOUR TURN" : "OPPONENT'S TURN"}
                        </span>
                    )}
                </div>
                <div className="score-box right-align">
                    <div style={{ textAlign: 'right' }}>
                        <span className="label">OPPONENT</span>
                        <div className="puzzle-score">{scores[myColor === 'black' ? 'white' : 'black'] || 0}</div>
                    </div>
                </div>
            </div>

            <div className="board-wrapper glass-panel">
                <div className="board board-10" ref={boardRef}>
                    {board.map((row, r) => (
                        row.map((cell, c) => (
                            <div
                                key={`${r}-${c}`}
                                className="cell"
                                style={{ backgroundColor: getCellColor(cell) }}
                            />
                        ))
                    ))}
                </div>
            </div>

            {/* Opponent Hand (Small View) */}
            <div style={{ width: '100%', maxWidth: '500px', marginBottom: '10px', opacity: 0.6 }}>
                <div style={{ fontSize: '0.8rem', color: '#fff', marginBottom: '5px' }}>Opponent's Hand</div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    {opponentHand.map((shape, i) => (
                        <div key={i} style={{ transform: 'scale(0.6)' }}>
                            {shape ? (
                                <div className="mini-grid" style={{
                                    gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)`
                                }}>
                                    {shape.matrix.map((row, r) => row.map((val, c) => (
                                        <div key={`${r}-${c}`} className="mini-cell"
                                            style={{ backgroundColor: val ? '#888' : 'transparent' }}
                                        />
                                    )))}
                                </div>
                            ) : <div style={{ width: 40, height: 40 }} />}
                        </div>
                    ))}
                </div>
            </div>

            {/* My Hand */}
            <div className="hand-container glass-panel">
                {myHand.map((shape, i) => (
                    <div
                        key={i}
                        className="shape-item"
                        onMouseDown={(e) => shape && handleTouchStart(e, shape, i)}
                        onTouchStart={(e) => shape && handleTouchStart(e, shape, i)}
                        style={{ opacity: draggingShape?.index === i ? 0 : 1 }}
                    >
                        {shape && (
                            <div className="mini-grid" style={{
                                gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)`
                            }}>
                                {shape.matrix.map((row, r) => row.map((val, c) => (
                                    <div key={`${r}-${c}`} className="mini-cell"
                                        style={{ backgroundColor: val ? colors[shape.colorKey] : 'transparent' }}
                                    />
                                )))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Drag Preview */}
            {draggingShape && (
                <div
                    className="drag-preview"
                    style={{
                        left: dragPos.x,
                        top: dragPos.y,
                        transform: 'translate(-50%, -50%)' // Center on finger
                    }}
                >
                    <div className="mini-grid" style={{
                        gridTemplateColumns: `repeat(${draggingShape.shape.matrix[0].length}, 1fr)`
                    }}>
                        {draggingShape.shape.matrix.map((row, r) => row.map((val, c) => (
                            <div key={`${r}-${c}`} className="mini-cell"
                                style={{
                                    backgroundColor: val ? colors[draggingShape.shape.colorKey] : 'transparent',
                                    width: '30px', height: '30px' // Slightly larger when dragging
                                }}
                            />
                        )))}
                    </div>
                </div>
            )}

            {/* Result Overlay */}
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
                        <button onClick={onBack} className="rematch-btn">
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
