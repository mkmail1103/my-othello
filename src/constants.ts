// Color Palettes for Block Puzzle
export const THEME_PALETTES = {
    neon: {
        green: '#34d399', blue: '#60a5fa', indigo: '#818cf8', yellow: '#facc15',
        red: '#f87171', purple: '#c084fc', lime: '#a3e635', orange: '#fb923c',
        pink: '#e879f9', teal: '#2dd4bf', rose: '#f43f5e'
    },
    pastel: {
        green: '#86efac', blue: '#93c5fd', indigo: '#a5b4fc', yellow: '#fde047',
        red: '#fca5a5', purple: '#d8b4fe', lime: '#bef264', orange: '#fdba74',
        pink: '#f9a8d4', teal: '#5eead4', rose: '#fda4af'
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

export type ColorKey = keyof typeof THEME_PALETTES.neon;

export const BASE_SCORES: { [key: number]: number } = {
    1: 30,
    2: 80,
    3: 200,
    4: 500,
    5: 1000,
    6: 2000,
    7: 3500,
    8: 5000
};

export type ShapeDef = {
    id: string;
    matrix: number[][];
    colorKey: ColorKey;
    difficulty: number;
    category: 'easy' | 'medium' | 'hard' | 'complex';
};

export const PUZZLE_SHAPES: ShapeDef[] = [
    // --- EASY (Square friendly / Line fillers) ---
    { id: 'I2', matrix: [[1, 1]], colorKey: 'green', difficulty: 1, category: 'easy' },
    { id: 'I2_V', matrix: [[1], [1]], colorKey: 'green', difficulty: 1, category: 'easy' },
    { id: 'I3', matrix: [[1, 1, 1]], colorKey: 'blue', difficulty: 2, category: 'easy' },
    { id: 'I3_V', matrix: [[1], [1], [1]], colorKey: 'blue', difficulty: 2, category: 'easy' },
    { id: 'I4', matrix: [[1, 1, 1, 1]], colorKey: 'indigo', difficulty: 2, category: 'easy' },
    { id: 'I4_V', matrix: [[1], [1], [1], [1]], colorKey: 'indigo', difficulty: 2, category: 'easy' },
    { id: 'SQR2', matrix: [[1, 1], [1, 1]], colorKey: 'red', difficulty: 2, category: 'easy' },
    { id: 'SQR3', matrix: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], colorKey: 'purple', difficulty: 3, category: 'easy' },
    { id: 'RECT2x3', matrix: [[1, 1, 1], [1, 1, 1]], colorKey: 'lime', difficulty: 3, category: 'easy' },
    { id: 'RECT3x2', matrix: [[1, 1], [1, 1], [1, 1]], colorKey: 'lime', difficulty: 3, category: 'easy' },

    // --- MEDIUM (Standard Tetris-ish) ---
    // L-Shapes (4 orientations)
    { id: 'L3', matrix: [[1, 0], [1, 1]], colorKey: 'purple', difficulty: 1, category: 'medium' },
    { id: 'L3_R', matrix: [[0, 1], [1, 1]], colorKey: 'purple', difficulty: 1, category: 'medium' },
    { id: 'L3_V', matrix: [[1, 1], [1, 0]], colorKey: 'purple', difficulty: 1, category: 'medium' },
    { id: 'L3_VR', matrix: [[1, 1], [0, 1]], colorKey: 'purple', difficulty: 1, category: 'medium' },

    // T-Shapes (4 orientations)
    { id: 'T3_D', matrix: [[1, 1, 1], [0, 1, 0]], colorKey: 'pink', difficulty: 2, category: 'medium' }, // Down
    { id: 'T3_U', matrix: [[0, 1, 0], [1, 1, 1]], colorKey: 'pink', difficulty: 2, category: 'medium' }, // Up
    { id: 'T3_L', matrix: [[0, 1], [1, 1], [0, 1]], colorKey: 'pink', difficulty: 2, category: 'medium' }, // Left
    { id: 'T3_R', matrix: [[1, 0], [1, 1], [1, 0]], colorKey: 'pink', difficulty: 2, category: 'medium' }, // Right

    // Z-Shapes (2 orientations)
    { id: 'Z3_H', matrix: [[1, 1, 0], [0, 1, 1]], colorKey: 'teal', difficulty: 2, category: 'medium' },
    { id: 'Z3_V', matrix: [[0, 1], [1, 1], [1, 0]], colorKey: 'teal', difficulty: 2, category: 'medium' },

    // S-Shapes (2 orientations)
    { id: 'S3_H', matrix: [[0, 1, 1], [1, 1, 0]], colorKey: 'teal', difficulty: 2, category: 'medium' },
    { id: 'S3_V', matrix: [[1, 0], [1, 1], [0, 1]], colorKey: 'teal', difficulty: 2, category: 'medium' },

    // --- HARD / COMPLEX (5-cell shapes) ---

    // I5 (Line)
    { id: 'I5', matrix: [[1, 1, 1, 1, 1]], colorKey: 'yellow', difficulty: 3, category: 'hard' },
    { id: 'I5_V', matrix: [[1], [1], [1], [1], [1]], colorKey: 'yellow', difficulty: 3, category: 'hard' },

    // L5 (5-cell L shape)
    { id: 'L5_0', matrix: [[1, 0, 0], [1, 0, 0], [1, 1, 1]], colorKey: 'orange', difficulty: 4, category: 'complex' },
    { id: 'L5_90', matrix: [[1, 1, 1], [1, 0, 0], [1, 0, 0]], colorKey: 'orange', difficulty: 4, category: 'complex' },
    { id: 'L5_180', matrix: [[1, 1, 1], [0, 0, 1], [0, 0, 1]], colorKey: 'orange', difficulty: 4, category: 'complex' },
    { id: 'L5_270', matrix: [[0, 0, 1], [0, 0, 1], [1, 1, 1]], colorKey: 'orange', difficulty: 4, category: 'complex' },

    // V5 (Corner/Kagi-gata 5-cell)
    { id: 'V5_0', matrix: [[1, 1, 1], [1, 0, 0], [1, 0, 0]], colorKey: 'pink', difficulty: 4, category: 'complex' },
    { id: 'V5_90', matrix: [[1, 1, 1], [0, 0, 1], [0, 0, 1]], colorKey: 'pink', difficulty: 4, category: 'complex' },
    { id: 'V5_180', matrix: [[0, 0, 1], [0, 0, 1], [1, 1, 1]], colorKey: 'pink', difficulty: 4, category: 'complex' },
    { id: 'V5_270', matrix: [[1, 0, 0], [1, 0, 0], [1, 1, 1]], colorKey: 'pink', difficulty: 4, category: 'complex' },
];
