// Use real dimensions instead of zoom-based scaling so Chrome popup sizing
// stays accurate and inputs/cards do not overflow horizontally.
// Keep global zoom neutral; readability is handled via targeted typography sizes.
export const EXTENSION_POPUP_UI_SCALE = 1;

export const EXTENSION_POPUP_BASE_WIDTH = 440;
export const EXTENSION_POPUP_BASE_MIN_HEIGHT = 720;

export const EXTENSION_CONNECT_APPROVAL_BASE_WIDTH = 420;
export const EXTENSION_CONNECT_APPROVAL_BASE_MIN_HEIGHT = 620;

export const EXTENSION_POPUP_WINDOW_WIDTH =
  Math.round(EXTENSION_POPUP_BASE_WIDTH * EXTENSION_POPUP_UI_SCALE) + 24;
export const EXTENSION_POPUP_WINDOW_HEIGHT =
  Math.round(EXTENSION_POPUP_BASE_MIN_HEIGHT * EXTENSION_POPUP_UI_SCALE) + 32;
