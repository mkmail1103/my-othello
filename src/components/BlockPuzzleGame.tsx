import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ThemeType } from '../types';
import { THEME_PALETTES, PUZZLE_SHAPES, BASE_SCORES, type ShapeDef, type ColorKey } from '../constants';
import './BlockPuzzleGame.css';

const DRAG_SENSITIVITY = 1.5;
const TOUCH_OFFSET_Y = 100;

// 振動の長さ（ミリ秒）。
const HAPTIC_DURATION = 15;

// 爽快感のあるプリセット（ID指定）
// const PRESET_COMBOS: string[][] = [
//     // The "User Requested" 8-width Combo (3 + 3 + 2)
//     ['SQR3', 'SQR3', 'RECT2x3'], 
//     ['SQR3', 'SQR3', 'RECT3x2'],
//     
//     // The "4+4" Line Builder
//     ['I4', 'I4', 'SQR2'], 
//     ['I4_V', 'I4_V', 'SQR2'],
// 
//     // The "5+3" Line Builder
//     ['I5', 'I3', 'I2'],
//     ['I5_V', 'I3_V', 'I2_V'],
// 
//     // The "Tetris" Classic (T, L, Z often fit together)
//     ['T3_D', 'L3', 'Z3_H'],
//     
//     // Big Block Bonanza (High risk high reward)
//     ['SQR3', 'L5_0', 'I3'],
// ];

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

const getSmartShapes = (grid: (string | null)[][], count: number) => {
    const shapes: ShapeDef[] = [];
    // Deep copy grid for simulation
    const simGrid = grid.map(row => [...row]);

    // Helper: Count filled cells on a grid
    const countFilled = (g: (string | null)[][]) => {
        let cnt = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (g[r][c] !== null) cnt++;
            }
        }
        return cnt;
    };

    // Helper: Calculate placement score with "Snug Fit" and 2-cell penalty
    const evaluatePlacement = (currentGrid: (string | null)[][], shape: ShapeDef) => {
        let bestScore = -9999;
        let bestMove: { r: number, c: number } | null = null;

        const currentFilledCount = countFilled(currentGrid);

        // Randomize order of check to add variety when scores are equal
        const startR = Math.floor(Math.random() * 8);
        const startC = Math.floor(Math.random() * 8);

        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const r = (startR + i) % 8;
                const c = (startC + j) % 8;

                if (canPlace(currentGrid, shape.matrix, r, c)) {
                    // Create a temporary grid to simulate the move fully (including clears)
                    const tempGrid = currentGrid.map(row => [...row]);

                    // 1. Place & Calculate Snug Fit
                    let blockSize = 0;
                    let touchingEdges = 0;
                    let totalEdges = 0;

                    for (let sr = 0; sr < shape.matrix.length; sr++) {
                        for (let sc = 0; sc < shape.matrix[0].length; sc++) {
                            if (shape.matrix[sr][sc] === 1) {
                                tempGrid[r + sr][c + sc] = 'sim';
                                blockSize++;

                                // Check 4 neighbors for Snug Fit
                                const neighbors = [
                                    [-1, 0], [1, 0], [0, -1], [0, 1]
                                ];
                                for (const [dr, dc] of neighbors) {
                                    const nr = r + sr + dr;
                                    const nc = c + sc + dc;
                                    totalEdges++;
                                    // Touch wall or existing block
                                    if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8 || currentGrid[nr][nc] !== null) {
                                        touchingEdges++;
                                    }
                                }
                            }
                        }
                    }

                    // 2. Detect Clears
                    const rowsToClear: number[] = [];
                    const colsToClear: number[] = [];
                    for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr].every(cell => cell !== null)) rowsToClear.push(rr); }
                    for (let cc = 0; cc < 8; cc++) {
                        let full = true;
                        for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr][cc] === null) { full = false; break; } }
                        if (full) colsToClear.push(cc);
                    }

                    // 3. Apply Clears
                    if (rowsToClear.length > 0 || colsToClear.length > 0) {
                        for (const rr of rowsToClear) { for (let cc = 0; cc < 8; cc++) tempGrid[rr][cc] = null; }
                        for (const cc of colsToClear) { for (let rr = 0; rr < 8; rr++) tempGrid[rr][cc] = null; }
                    }

                    const newFilledCount = countFilled(tempGrid);
                    const linesCleared = rowsToClear.length + colsToClear.length;

                    // --- SCORING LOGIC ---
                    let score = blockSize; // Base score

                    // ALL CLEAR BONUS (Critical for User Request)
                    if (newFilledCount === 0 && currentFilledCount > 0) {
                        score += 50000; // Massive bonus
                    }
                    // REDUCER BONUS
                    else if (newFilledCount < currentFilledCount) {
                        const reduction = currentFilledCount - newFilledCount;
                        score += reduction * 20;
                    }

                    // Line Clear Bonus
                    if (linesCleared > 0) {
                        score += linesCleared * 15;
                    }

                    // Snug Fit Bonus (0 to 1 ratio)
                    const snugRatio = totalEdges > 0 ? touchingEdges / totalEdges : 0;
                    score += snugRatio * 10; // Up to +10 points for perfect fit

                    // Penalize boring small blocks (2-cell) if they don't help clean up or fit perfectly
                    const isSmall = blockSize <= 2;
                    if (isSmall) {
                        if (linesCleared === 0) {
                            // If it's floating (low snug ratio), penalize heavily
                            if (snugRatio < 0.5) {
                                score -= 50; // Don't pick floating small blocks
                            } else {
                                score -= 10; // Even if fitting, prefer larger blocks unless necessary
                            }
                        }
                    }

                    // Bonus for "Hard" pieces if they fit (keeps game interesting)
                    if (shape.category === 'hard' || shape.category === 'complex') {
                        score += 5;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        bestMove = { r, c };
                    }
                }
            }
        }
        return { bestScore, bestMove };
    };

    // --- STRATEGY: Hole Filling (Find shapes that fit gaps) ---
    const findHoleFillers = (currentGrid: (string | null)[][]): ShapeDef[] => {
        const visited = Array(8).fill(null).map(() => Array(8).fill(false));
        const holes: { r: number, c: number }[][] = [];

        // 1. Find connected empty components (holes)
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (currentGrid[r][c] === null && !visited[r][c]) {
                    const hole: { r: number, c: number }[] = [];
                    const queue = [{ r, c }];
                    visited[r][c] = true;

                    while (queue.length > 0) {
                        const curr = queue.shift()!;
                        hole.push(curr);

                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        for (const [dr, dc] of dirs) {
                            const nr = curr.r + dr;
                            const nc = curr.c + dc;
                            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && currentGrid[nr][nc] === null && !visited[nr][nc]) {
                                visited[nr][nc] = true;
                                queue.push({ r: nr, c: nc });
                            }
                        }
                    }
                    holes.push(hole);
                }
            }
        }

        // 2. Match holes to shapes
        const matchingShapes: ShapeDef[] = [];

        for (const hole of holes) {
            if (hole.length > 5) continue; // Ignore large open spaces
            if (hole.length < 2) continue; // Ignore 1x1 holes (no shape fits)

            // Normalize hole coordinates
            const minR = Math.min(...hole.map(p => p.r));
            const minC = Math.min(...hole.map(p => p.c));

            // Create a matrix signature for the hole
            const maxR = Math.max(...hole.map(p => p.r));
            const maxC = Math.max(...hole.map(p => p.c));
            const height = maxR - minR + 1;
            const width = maxC - minC + 1;

            // Check against all shapes
            for (const shape of PUZZLE_SHAPES) {
                if (shape.matrix.length === height && shape.matrix[0].length === width) {
                    let match = true;
                    let blockCount = 0;
                    for (let r = 0; r < height; r++) {
                        for (let c = 0; c < width; c++) {
                            const isHole = hole.some(p => p.r === minR + r && p.c === minC + c);
                            const isBlock = shape.matrix[r][c] === 1;
                            if (isHole !== isBlock) {
                                match = false;
                                break;
                            }
                            if (isBlock) blockCount++;
                        }
                        if (!match) break;
                    }
                    if (match && blockCount === hole.length) {
                        matchingShapes.push(shape);
                    }
                }
            }
        }

        // Return unique shapes
        return Array.from(new Set(matchingShapes));
    };

    // --- STRATEGY: All Clear Search (Greedy Depth 3) ---
    // Tries to find a sequence of 3 shapes that results in an empty board
    const findAllClearSequence = (startGrid: (string | null)[][], depth: number): ShapeDef[] | null => {
        if (depth === 0) return null;

        // Heuristic: Only try this if board is relatively clean to save perf
        if (countFilled(startGrid) > 25) return null;

        // Try top candidates
        const candidates = PUZZLE_SHAPES.map(shape => {
            const res = evaluatePlacement(startGrid, shape);
            return { shape, ...res };
        })
            .filter(c => c.bestMove !== null)
            .sort((a, b) => b.bestScore - a.bestScore)
            .slice(0, 5); // Only check top 5 moves to limit branching

        for (const cand of candidates) {
            const { shape, bestMove } = cand;
            if (!bestMove) continue;

            // Simulate move
            const tempGrid = startGrid.map(row => [...row]);
            const { r, c } = bestMove;

            // Place
            for (let sr = 0; sr < shape.matrix.length; sr++) {
                for (let sc = 0; sc < shape.matrix[0].length; sc++) {
                    if (shape.matrix[sr][sc] === 1) tempGrid[r + sr][c + sc] = 'sim';
                }
            }
            // Clear
            const rowsToClear: number[] = [];
            const colsToClear: number[] = [];
            for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr].every(cell => cell !== null)) rowsToClear.push(rr); }
            for (let cc = 0; cc < 8; cc++) {
                let full = true;
                for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr][cc] === null) { full = false; break; } }
                if (full) colsToClear.push(cc);
            }
            if (rowsToClear.length > 0 || colsToClear.length > 0) {
                for (const rr of rowsToClear) { for (let cc = 0; cc < 8; cc++) tempGrid[rr][cc] = null; }
                for (const cc of colsToClear) { for (let rr = 0; rr < 8; rr++) tempGrid[rr][cc] = null; }
            }

            // Check if All Clear
            if (countFilled(tempGrid) === 0) {
                return [shape];
            }

            // Recurse
            const nextSteps = findAllClearSequence(tempGrid, depth - 1);
            if (nextSteps) {
                return [shape, ...nextSteps];
            }
        }
        return null;
    };


    // --- MAIN SELECTION LOGIC ---

    // 1. Try to find an All Clear Sequence first
    const allClearSeq = findAllClearSequence(simGrid, count);
    if (allClearSeq && allClearSeq.length === count) {
        return allClearSeq;
    }

    // 2. Identify Hole Fillers
    const holeFillers = findHoleFillers(simGrid);

    for (let i = 0; i < count; i++) {
        // If we have hole fillers and it's the first or second pick, use them!
        if (holeFillers.length > 0 && i < holeFillers.length && Math.random() < 0.7) {
            const filler = holeFillers[i % holeFillers.length];
            // Verify it still fits (simGrid changes)
            if (evaluatePlacement(simGrid, filler).bestMove) {
                shapes.push(filler);

                // Update SimGrid
                const res = evaluatePlacement(simGrid, filler);
                if (res.bestMove) {
                    const { r, c } = res.bestMove;
                    // ... apply to simGrid (simplified update for brevity, assuming filler fits hole)
                    // Actually we need to update simGrid properly to ensure next pieces fit
                    // Copy-paste update logic:
                    const tempGrid = simGrid.map(row => [...row]);
                    for (let sr = 0; sr < filler.matrix.length; sr++) {
                        for (let sc = 0; sc < filler.matrix[0].length; sc++) {
                            if (filler.matrix[sr][sc] === 1) tempGrid[r + sr][c + sc] = 'sim';
                        }
                    }
                    // Clear logic...
                    const rowsToClear: number[] = [];
                    const colsToClear: number[] = [];
                    for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr].every(cell => cell !== null)) rowsToClear.push(rr); }
                    for (let cc = 0; cc < 8; cc++) {
                        let full = true;
                        for (let rr = 0; rr < 8; rr++) { if (tempGrid[rr][cc] === null) { full = false; break; } }
                        if (full) colsToClear.push(cc);
                    }
                    if (rowsToClear.length > 0 || colsToClear.length > 0) {
                        for (const rr of rowsToClear) { for (let cc = 0; cc < 8; cc++) tempGrid[rr][cc] = null; }
                        for (const cc of colsToClear) { for (let rr = 0; rr < 8; rr++) tempGrid[rr][cc] = null; }
                    }
                    for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) simGrid[r][c] = tempGrid[r][c]; }
                }
                continue;
            }
        }

        // 3. Standard Smart Selection
        const candidates = PUZZLE_SHAPES.map(shape => {
            const result = evaluatePlacement(simGrid, shape);
            return { shape, score: result.bestScore, bestMove: result.bestMove };
        }).filter(c => c.bestMove !== null);

        if (candidates.length === 0) {
            shapes.push(PUZZLE_SHAPES[Math.floor(Math.random() * PUZZLE_SHAPES.length)]);
            continue;
        }

        candidates.sort((a, b) => b.score - a.score);

        let selected;
        if (candidates[0].score > 10000) { // All Clear or massive clear
            selected = candidates[0];
        } else {
            // Pick from top 3
            const topN = candidates.slice(0, 3);
            selected = topN[Math.floor(Math.random() * topN.length)];
        }

        shapes.push(selected.shape);

        // Update SimGrid for next iteration
        const { r: placeR, c: placeC } = selected.bestMove!;
        const tempGrid = simGrid.map(row => [...row]);

        for (let r = 0; r < selected.shape.matrix.length; r++) {
            for (let c = 0; c < selected.shape.matrix[0].length; c++) {
                if (selected.shape.matrix[r][c] === 1) tempGrid[placeR + r][placeC + c] = 'sim';
            }
        }
        const rowsToClear: number[] = [];
        const colsToClear: number[] = [];
        for (let r = 0; r < 8; r++) { if (tempGrid[r].every(c => c !== null)) rowsToClear.push(r); }
        for (let c = 0; c < 8; c++) {
            let full = true;
            for (let r = 0; r < 8; r++) { if (tempGrid[r][c] === null) { full = false; break; } }
            if (full) colsToClear.push(c);
        }
        if (rowsToClear.length > 0 || colsToClear.length > 0) {
            for (const r of rowsToClear) { for (let c = 0; c < 8; c++) tempGrid[r][c] = null; }
            for (const c of colsToClear) { for (let r = 0; r < 8; r++) tempGrid[r][c] = null; }
        }

        for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) simGrid[r][c] = tempGrid[r][c]; }
    }

    return shapes;
};

const BlockPuzzleGame: React.FC<{ onBack: () => void; theme: ThemeType }> = ({ onBack, theme }) => {
    const [grid, setGrid] = useState<(string | null)[][]>(Array(8).fill(null).map(() => Array(8).fill(null)));
    const [clearingCells, setClearingCells] = useState<string[]>([]);
    const [hand, setHand] = useState<(ShapeDef | null)[]>(() => getSmartShapes(Array(8).fill(null).map(() => Array(8).fill(null)), 3));
    const [score, setScore] = useState(0);
    const [combo, setCombo] = useState(0);
    const [movesSinceClear, setMovesSinceClear] = useState(0);
    const [comboText, setComboText] = useState<{ main: string, sub: string } | null>(null);

    const [isMuted, setIsMuted] = useState(false);

    const audioContextRef = useRef<AudioContext | null>(null);
    const audioBuffersRef = useRef<{ [key: string]: AudioBuffer }>({});
    const bgmSourceRef = useRef<AudioBufferSourceNode | null>(null);

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
        };

        ['pickup', 'place', 'clear', 'gameover', 'bgm'].forEach(name => loadSound(name));

        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    const playSound = useCallback((type: 'pickup' | 'place' | 'clear' | 'gameover') => {
        if (isMuted || !audioContextRef.current || !audioBuffersRef.current[type]) return;
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const source = ctx.createBufferSource();
        source.buffer = audioBuffersRef.current[type];
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.5;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
    }, [isMuted]);

    // Haptic Feedback Helper
    const triggerHaptic = () => {
        if (navigator.vibrate) {
            navigator.vibrate(HAPTIC_DURATION);
        }
    };

    useEffect(() => {
        const startBGM = () => {
            if (isMuted || !audioContextRef.current || !audioBuffersRef.current['bgm']) return;
            if (bgmSourceRef.current) return;
            const ctx = audioContextRef.current;
            const source = ctx.createBufferSource();
            source.buffer = audioBuffersRef.current['bgm'];
            source.loop = true;
            const gainNode = ctx.createGain();
            gainNode.gain.value = 0.3;
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

        if (isMuted) {
            stopBGM();
        } else {
            const checkBuffer = setInterval(() => {
                if (audioBuffersRef.current['bgm']) {
                    startBGM();
                    clearInterval(checkBuffer);
                }
            }, 500);
            return () => { clearInterval(checkBuffer); stopBGM(); };
        }
    }, [isMuted]);

    const toggleMute = () => { setIsMuted(prev => !prev); };

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

    useEffect(() => {
        if (isGameOver) playSound('gameover');
    }, [isGameOver, playSound]);

    const addFloatingText = (x: number, y: number, text: string) => {
        const id = floatingTextId.current++;
        setFloatingTexts(prev => [...prev, { id, x, y, text }]);
        setTimeout(() => {
            setFloatingTexts(prev => prev.filter(ft => ft.id !== id));
        }, 1000);
    };

    const handlePointerDown = (e: React.PointerEvent, idx: number) => {
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
        if (isGameOver || hand[idx] === null) return;
        playSound('pickup');
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

                playSound('place');

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

                setScore(prev => prev + placementScore);

                const newHand = [...hand];
                newHand[shapeIdx] = null;
                setHand(newHand);
                setGrid(newGrid);

                checkLinesAndScore(newGrid, placementScore, currentX, currentY - TOUCH_OFFSET_Y);
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

    const checkLinesAndScore = (currentGrid: (string | null)[][], initialPlacementScore: number, animX: number, animY: number) => {
        const rowsToClear: number[] = [];
        const colsToClear: number[] = [];
        for (let r = 0; r < 8; r++) { if (currentGrid[r].every(cell => cell !== null)) rowsToClear.push(r); }
        for (let c = 0; c < 8; c++) {
            let full = true;
            for (let r = 0; r < 8; r++) { if (currentGrid[r][c] === null) { full = false; break; } }
            if (full) colsToClear.push(c);
        }

        const totalLines = rowsToClear.length + colsToClear.length;
        let totalMoveScore = initialPlacementScore;

        if (totalLines > 0) {
            playSound('clear');
            triggerHaptic(); // Vibrate when clearing lines
            setMovesSinceClear(0);

            const addedCombo = totalLines;
            const newCombo = combo + addedCombo;
            setCombo(newCombo);

            const baseLineScore = BASE_SCORES[totalLines] || (totalLines * 50);
            const lineScore = baseLineScore * newCombo;
            totalMoveScore += lineScore;

            let isAllClear = true;
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (currentGrid[r][c] !== null && !rowsToClear.includes(r) && !colsToClear.includes(c)) {
                        isAllClear = false;
                        break;
                    }
                }
                if (!isAllClear) break;
            }

            if (isAllClear) {
                totalMoveScore += 300;
                setTimeout(() => {
                    setComboText({ main: "ALL CLEAR!", sub: "+300 Points" });
                    setTimeout(() => setComboText(null), 2000);
                }, 500);
            }

            if (newCombo >= 2) {
                let mainText = "Good!";
                if (newCombo >= 5) mainText = "Great!";
                if (newCombo >= 10) mainText = "Unstoppable!";
                if (totalLines >= 3) mainText = "Incredible!";

                if (!isAllClear) {
                    setComboText({ main: mainText, sub: `Combo x${newCombo}` });
                    setTimeout(() => setComboText(null), 1500);
                }
            }

            const cellsToAnim: string[] = [];
            rowsToClear.forEach(r => { for (let c = 0; c < 8; c++) cellsToAnim.push(`${r}-${c}`); });
            colsToClear.forEach(c => { for (let r = 0; r < 8; r++) cellsToAnim.push(`${r}-${c}`); });
            setClearingCells(cellsToAnim);

            setTimeout(() => {
                setScore(prev => prev + lineScore + (isAllClear ? 300 : 0));
                const nextGrid = currentGrid.map(row => [...row]);
                rowsToClear.forEach(r => { for (let c = 0; c < 8; c++) nextGrid[r][c] = null; });
                colsToClear.forEach(c => { for (let r = 0; r < 8; r++) nextGrid[r][c] = null; });
                setGrid(nextGrid);
                setClearingCells([]);
            }, 400);
        } else {
            const newMovesSinceClear = movesSinceClear + 1;
            setMovesSinceClear(newMovesSinceClear);

            const limit = combo >= 10 ? 3 : 2;

            if (newMovesSinceClear > limit) {
                if (combo > 0) {
                    setCombo(0);
                }
                setMovesSinceClear(0);
            }
        }

        addFloatingText(animX, animY, `+${totalMoveScore}`);
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
                            <div className="combo-badge animate-pulse" style={{ color: combo >= 10 ? '#ffd700' : 'var(--accent-color)' }}>
                                {combo}x COMBO
                            </div>
                            {combo >= 10 ? (
                                <div className="shield-indicator" title="Shield Active: Protects combo from 3 misses">
                                    🛡️ {3 - movesSinceClear} left
                                </div>
                            ) : (
                                <div className="shield-indicator-small" style={{ fontSize: '0.75rem', opacity: 0.9, color: movesSinceClear === 2 ? '#ff6b6b' : 'inherit' }}>
                                    {movesSinceClear === 0 ? "Safe" :
                                        movesSinceClear === 1 ? "⚠️ Careful" : "🔥 Last Chance"}
                                </div>
                            )}
                        </div>
                    ) : (
                        <span className="game-title-small">BLOCK PUZZLE</span>
                    )}
                </div>

                <div className="right-align">
                    <button onClick={toggleMute} className="sound-btn" aria-label="Toggle Sound">
                        {isMuted ? '🔇' : '🔊'}
                    </button>
                    <button onClick={onBack} className="leave-btn">Exit</button>
                </div>
            </div>

            <div className="board-wrapper glass-panel">
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
                                style={cell ? { backgroundColor: cell } : {}}
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

            {dragState && hand[dragState.shapeIdx] && (
                <div className="drag-preview" style={{ left: dragState.currentX, top: dragState.currentY - TOUCH_OFFSET_Y, transform: 'translate(-50%, -50%)' }}>
                    <div className="mini-grid" style={{
                        gridTemplateColumns: `repeat(${hand[dragState.shapeIdx]!.matrix[0].length}, 1fr)`,
                        width: `${hand[dragState.shapeIdx]!.matrix[0].length * dragState.boardCellSize}px`,
                    }}>
                        {hand[dragState.shapeIdx]!.matrix.map((row, r) => row.map((val, c) => (
                            <div key={`${r}-${c}`} className="mini-cell" style={{
                                backgroundColor: val ? getThemeColor(hand[dragState.shapeIdx]!.colorKey) : 'transparent',
                                width: `${dragState.boardCellSize}px`, height: `${dragState.boardCellSize}px`,
                                border: val ? 'var(--cell-border)' : 'none'
                            }} />
                        )))}
                    </div>
                </div>
            )}
            <div className="instructions">Drag blocks to grid</div>
        </div>
    );
};

export default BlockPuzzleGame;