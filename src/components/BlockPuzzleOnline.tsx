import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import { THEME_PALETTES, type ShapeDef, type ColorKey } from '../constants.js';
import './BlockPuzzleGame.css';

interface BlockPuzzleOnlineProps {
    onBack: () => void;
    theme: string;
}

type GameStatus = 'LOBBY' | 'WAITING' | 'PLAYING' | 'FINISHED' | 'ABORTED';

const DRAG_SENSITIVITY = 1.5;
const TOUCH_OFFSET_Y = 100;
const BOARD_SIZE = 10;
const HAPTIC_DURATION = 15;

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

    // --- エフェクト＆サウンド用ステート ---
    const [clearingCells, setClearingCells] = useState<string[]>([]);
    const [highlightLines, setHighlightLines] = useState<{ rows: number[], cols: number[] }>({ rows: [], cols: [] });
    const [isMuted, setIsMuted] = useState(false);

    const audioContextRef = useRef<AudioContext | null>(null);
    const audioBuffersRef = useRef<{ [key: string]: AudioBuffer }>({});
    const bgmSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const prevScoresRef = useRef<{ black: number, white: number }>({ black: 0, white: 0 });

    const [dragState, setDragState] = useState<{
        shapeIdx: number; startX: number; startY: number; currentX: number; currentY: number;
        startPointerX: number; startPointerY: number; hoverRow: number | null; hoverCol: number | null; boardCellSize: number;
    } | null>(null);

    const boardRef = useRef<HTMLDivElement>(null);
    const boardMetrics = useRef<{ left: number, top: number, width: number, height: number, cellSize: number } | null>(null);

    const colors = useMemo(() => THEME_PALETTES[theme as keyof typeof THEME_PALETTES] || THEME_PALETTES['neon'], [theme]);

    // ★白・黒の代わりに、見やすい対戦カラーにする設定
    const getCellColor = useCallback((val: string | null) => {
        if (!val) return 'transparent';
        if (val === 'black') return '#4a90e2'; // P1: ブルー（青）
        if (val === 'white') return '#e94b3c'; // P2: レッド（赤）
        if (colors[val as ColorKey]) return colors[val as ColorKey];
        return val;
    }, [colors]);

    const myPlayerColor = useMemo(() => getCellColor(myColor), [getCellColor, myColor]);

    // --- サウンド初期化 ---
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        if (AudioContextClass) {
            audioContextRef.current = new AudioContextClass();
        }

        const loadSound = async (name: string) => {
            if (!audioContextRef.current) return;
            try {
                const response = await fetch(`/sounds/${name}.mp3`);
                const arrayBuffer = await response.arrayBuffer();
                const decodedBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
                audioBuffersRef.current[name] = decodedBuffer;
            } catch (error) {
                console.error(`Failed to load sound: ${name}`, error);
            }
        };['pickup', 'place', 'clear', 'gameover', 'bgm'].forEach(name => loadSound(name));

        return () => {
            if (audioContextRef.current) audioContextRef.current.close();
        };
    }, []);

    const playSound = useCallback((type: 'pickup' | 'place' | 'clear' | 'gameover') => {
        if (isMuted || !audioContextRef.current || !audioBuffersRef.current[type]) return;
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const source = ctx.createBufferSource();
        source.buffer = audioBuffersRef.current[type];
        const gainNode = ctx.createGain();
        gainNode.gain.value = type === 'clear' ? 0.6 : 0.4; // クリア音は少し大きめに
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
    }, [isMuted]);

    // BGM制御
    useEffect(() => {
        const startBGM = () => {
            if (isMuted || !audioContextRef.current || !audioBuffersRef.current['bgm']) return;
            if (bgmSourceRef.current) return;
            const ctx = audioContextRef.current;
            const source = ctx.createBufferSource();
            source.buffer = audioBuffersRef.current['bgm'];
            source.loop = true;
            const gainNode = ctx.createGain();
            gainNode.gain.value = 0.25; // BGM音量
            source.connect(gainNode);
            gainNode.connect(ctx.destination);
            source.start(0);
            bgmSourceRef.current = source;
        };

        const stopBGM = () => {
            if (bgmSourceRef.current) {
                try { bgmSourceRef.current.stop(); } catch { /* ignore */ }
                bgmSourceRef.current = null;
            }
        };

        if (status === 'PLAYING' && !isMuted) {
            startBGM();
        } else {
            stopBGM();
        }
        return () => stopBGM();
    }, [isMuted, status]);

    const toggleMute = () => { setIsMuted(prev => !prev); };

    // ゲームオーバー音
    useEffect(() => {
        if (status === 'FINISHED') playSound('gameover');
    }, [status, playSound]);

    // 相手が置いた/消した時の音の検知
    useEffect(() => {
        if (status === 'PLAYING') {
            const oppColor = myColor === 'black' ? 'white' : 'black';
            const oppPrev = prevScoresRef.current[oppColor as 'black' | 'white'] || 0;
            const oppCurr = scores[oppColor as 'black' | 'white'] || 0;

            if (oppCurr > oppPrev) {
                const diff = oppCurr - oppPrev;
                if (diff >= 100) {
                    playSound('clear'); // ラインを消したスコアならクリア音
                } else {
                    playSound('place'); // ブロックを置いただけなら配置音
                }
            }
        }
        prevScoresRef.current = scores;
    }, [scores, status, myColor, playSound]);


    // --- ソケット通信 ---
    useEffect(() => {
        socket.connect();
        socket.on('init_puzzle_game', ({ color, roomId }) => {
            setMyColor(color);
            setRoomId(roomId);
            setStatus('WAITING');
            setErrorMsg('');
        });

        socket.on('waiting_opponent', () => setStatus('WAITING'));

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

        socket.on('error_message', (msg) => setErrorMsg(msg));

        return () => {
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
            // ローカルでクリア判定してエフェクトを先行発動
            const tempBoard = board.map(row => [...row]);
            for (let i = 0; i < shape.matrix.length; i++) {
                for (let j = 0; j < shape.matrix[0].length; j++) {
                    if (shape.matrix[i][j] === 1) tempBoard[r + i][c + j] = myColor;
                }
            }

            const rowsToClear: number[] = [];
            const colsToClear: number[] = [];
            for (let rr = 0; rr < BOARD_SIZE; rr++) { if (tempBoard[rr].every(cell => cell !== null)) rowsToClear.push(rr); }
            for (let cc = 0; cc < BOARD_SIZE; cc++) {
                let full = true;
                for (let rr = 0; rr < BOARD_SIZE; rr++) { if (tempBoard[rr][cc] === null) { full = false; break; } }
                if (full) colsToClear.push(cc);
            }

            if (rowsToClear.length > 0 || colsToClear.length > 0) {
                playSound('clear');
                if (navigator.vibrate) navigator.vibrate(HAPTIC_DURATION);

                const cellsToAnim: string[] = [];
                rowsToClear.forEach(rr => { for (let cc = 0; cc < BOARD_SIZE; cc++) cellsToAnim.push(`${rr}-${cc}`); });
                colsToClear.forEach(cc => { for (let rr = 0; rr < BOARD_SIZE; rr++) cellsToAnim.push(`${rr}-${cc}`); });
                setClearingCells(cellsToAnim);
                setTimeout(() => setClearingCells([]), 400);
            } else {
                playSound('place');
            }

            // サーバーに送信
            socket.emit('puzzle_move', { roomId, shapeIndex: index, row: r, col: c });
        }
    }, [board, canPlace, roomId, socket, myColor, playSound]);

    // --- ドラッグロジック ---
    const handlePointerDown = (e: React.PointerEvent, idx: number) => {
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
        if (status !== 'PLAYING' || turn !== myColor || !myHand[idx]) return;

        playSound('pickup');

        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);

        let currentCellSize = 30;
        if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            currentCellSize = rect.width / BOARD_SIZE;
            boardMetrics.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, cellSize: currentCellSize };
        }

        setDragState({
            shapeIdx: idx, startX: e.clientX, startY: e.clientY,
            startPointerX: e.clientX, startPointerY: e.clientY,
            currentX: e.clientX, currentY: e.clientY,
            hoverRow: null, hoverCol: null, boardCellSize: currentCellSize
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

            // ハイライト（白光り）の計算
            if (bestRow !== null && bestCol !== null) {
                const tempBoard = board.map(row => [...row]);
                for (let i = 0; i < shape.matrix.length; i++) {
                    for (let j = 0; j < shape.matrix[0].length; j++) {
                        if (shape.matrix[i][j] === 1) tempBoard[bestRow + i][bestCol + j] = myColor;
                    }
                }
                for (let rr = 0; rr < BOARD_SIZE; rr++) { if (tempBoard[rr].every(cell => cell !== null)) hRows.push(rr); }
                for (let cc = 0; cc < BOARD_SIZE; cc++) {
                    let full = true;
                    for (let rr = 0; rr < BOARD_SIZE; rr++) { if (tempBoard[rr][cc] === null) { full = false; break; } }
                    if (full) hCols.push(cc);
                }
            }
        }
        setHighlightLines({ rows: hRows, cols: hCols });
        setDragState(prev => prev ? { ...prev, currentX, currentY, hoverRow: bestRow, hoverCol: bestCol } : null);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState) return;
        const { shapeIdx, hoverRow, hoverCol } = dragState;
        const shape = myHand[shapeIdx];

        const target = e.currentTarget as HTMLElement;
        target.releasePointerCapture(e.pointerId);

        setHighlightLines({ rows: [], cols: [] });

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

    // --- レンダリング ---
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
                    <button onClick={handleJoin} className="join-btn neon-btn" style={{ marginTop: '2rem' }}>Join Game</button>
                    <button onClick={onBack} className="back-link" style={{ marginTop: '1rem', width: '100%', textAlign: 'center' }}>Back to Menu</button>
                </div>
            </div>
        );
    }

    return (
        <div className="game-container puzzle-mode" style={{
            touchAction: 'none',
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxSizing: 'border-box',
            backgroundColor: 'var(--bg-color)',
            paddingTop: 'max(env(safe-area-inset-top), 10px)',
            paddingBottom: 'max(env(safe-area-inset-bottom), 10px)'
        }}>

            {/* 1. 上部コントロールバー */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0 15px',
                height: '40px',
                flexShrink: 0,
                width: '100%',
                boxSizing: 'border-box'
            }}>
                <button onClick={onBack} style={{
                    background: 'rgba(255, 255, 255, 0.2)', border: 'none', borderRadius: '8px',
                    padding: '6px 15px', color: '#fff', fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer'
                }}>
                    Leave
                </button>
                <button onClick={toggleMute} style={{
                    background: 'rgba(255, 255, 255, 0.2)', border: 'none', borderRadius: '50%',
                    width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.2rem', cursor: 'pointer'
                }}>
                    {isMuted ? '🔇' : '🔊'}
                </button>
            </div>

            {/* 2. スコアボード */}
            <div className="scoreboard glass-panel puzzle-header-layout" style={{
                margin: '5px 15px',
                flexShrink: 0,
                position: 'relative',
                zIndex: 10
            }}>
                <div className="score-box left-align">
                    <span className="label" style={{ color: myPlayerColor }}>YOU</span>
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

            {/* ★ 3. 盤面エリア（ズレと被りを完全に防ぐ構造に作り直し） */}
            <div style={{
                flexGrow: 1,
                minHeight: '300px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                padding: '10px 15px', /* 盤面の上下に安全なスキマを確保 */
                boxSizing: 'border-box'
            }}>
                {/* 盤面を絶対に正方形に保つための「見えない枠」 */}
                <div style={{
                    width: '90%',
                    maxWidth: '350px',
                    maxHeight: '100%',
                    aspectRatio: '1 / 1',
                    position: 'relative' /* 中身をこの枠内にピッタリ貼り付ける指示 */
                }}>
                    {/* 背景パネル（見えない枠にピッタリ張り付く） */}
                    <div className="board-wrapper glass-panel" style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        padding: '6px',
                        boxSizing: 'border-box',
                        display: 'flex'
                    }}>
                        {/* 実際のマス目（背景パネルの中でさらにピッタリ広がる） */}
                        <div className="board puzzle-board" ref={boardRef} style={{
                            flexGrow: 1,
                            display: 'grid',
                            gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
                            gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)`, /* 縦方向も均等に分割 */
                            width: '100%',
                            height: '100%',
                            boxSizing: 'border-box'
                        }}>
                            {board.map((row, r) => (
                                row.map((cell, c) => {
                                    const cellKey = `${r}-${c}`;
                                    const isGhost = ghostCells.includes(cellKey);
                                    const isClearing = clearingCells.includes(cellKey);
                                    const isHighlightRow = highlightLines.rows.includes(r);
                                    const isHighlightCol = highlightLines.cols.includes(c);

                                    return (
                                        <div
                                            key={cellKey}
                                            className={`cell puzzle-cell ${isGhost ? 'ghost-active' : ''} ${isClearing ? 'clearing' : ''}`}
                                            style={cell ? { backgroundColor: getCellColor(cell) } : {}}
                                        >
                                            {isGhost && <div className="ghost-overlay" style={{ backgroundColor: myPlayerColor, opacity: 0.5 }} />}
                                            {(isHighlightRow || isHighlightCol) && <div className="potential-clear-overlay" />}
                                        </div>
                                    );
                                })
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* 4. 相手の手札 */}
            <div style={{ width: '100%', opacity: 0.8, flexShrink: 0, height: '45px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#fff', marginBottom: '2px' }}>Opponent's Hand</div>
                <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
                    {opponentHand.map((shape, i) => (
                        <div key={i} style={{ width: '40px', height: '40px', position: 'relative' }}>
                            {shape && (
                                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) scale(0.4)' }}>
                                    <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${shape.matrix[0].length}, 1fr)` }}>
                                        {shape.matrix.map((row, r) => row.map((val, c) => (
                                            <div key={`${r}-${c}`} className="mini-cell" style={{
                                                backgroundColor: val ? getCellColor(myColor === 'black' ? 'white' : 'black') : 'transparent',
                                                border: val ? '1px solid rgba(255,255,255,0.2)' : 'none'
                                            }} />
                                        )))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* ★ 5. 自分の手札（高さを100px→80pxにスリム化、ブロックも少し小さく調整） */}
            <div className="hand-container glass-panel" style={{
                flexShrink: 0,
                height: '45px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '5px 15px 10px',
                padding: '5px 10px'
            }}>
                {myHand.map((shape, idx) => {
                    const isDragging = dragState?.shapeIdx === idx;
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
                                            backgroundColor: val ? myPlayerColor : 'transparent',
                                            border: val ? '1px solid rgba(255,255,255,0.2)' : 'none',
                                            width: '20px', /* ブロックサイズを微調整 */
                                            height: '20px'
                                        }} />
                                    )))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ドラッグ中のプレビュー */}
            {dragState && myHand[dragState.shapeIdx] && (
                <div className="drag-preview" style={{ left: dragState.currentX, top: dragState.currentY - TOUCH_OFFSET_Y, transform: 'translate(-50%, -50%)' }}>
                    <div className="mini-grid" style={{
                        gridTemplateColumns: `repeat(${myHand[dragState.shapeIdx]!.matrix[0].length}, 1fr)`,
                        width: `${myHand[dragState.shapeIdx]!.matrix[0].length * dragState.boardCellSize}px`,
                    }}>
                        {myHand[dragState.shapeIdx]!.matrix.map((row, r) => row.map((val, c) => (
                            <div key={`${r}-${c}`} className="mini-cell" style={{
                                backgroundColor: val ? myPlayerColor : 'transparent',
                                width: `${dragState.boardCellSize}px`, height: `${dragState.boardCellSize}px`,
                                border: val ? '1px solid rgba(255,255,255,0.2)' : 'none'
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
        </div>
    );
};

export default BlockPuzzleOnline;