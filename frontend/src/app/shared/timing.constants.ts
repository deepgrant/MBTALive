// Polling cadences and UI timing values shared across the app.

/** Vehicle-position poll cadence while a route is selected. */
export const VEHICLE_POLL_MS = 10_000;

/** Train-board data poll cadence while the board is visible. */
export const BOARD_POLL_MS = 15_000;

/** Alert poll cadence (both per-route and global). */
export const ALERT_POLL_MS = 90_000;

/** Renews the serverless hot-route lease while a selected route is visible. */
export const ROUTE_ACTIVITY_HEARTBEAT_MS = 60_000;

/** Maximum initial wait before an empty hot-route snapshot is treated as genuinely empty. */
export const ROUTE_WARMUP_MS = 35_000;

/** Snapshot health polling cadence. */
export const STATUS_POLL_MS = 60_000;

/** Last-known positions older than this are discarded instead of being rendered as stale. */
export const POSITION_STALE_MAX_MS = 30_000;

/** Lets the map initialize on desktop before the cookie-saved route is selected. */
export const ROUTE_RESTORE_DELAY_MS = 800;

/** Defers map construction until the container element has its final size. */
export const MAP_INIT_DELAY_MS = 300;

/** Lets route/station layers settle before framing the map to them. */
export const MAP_FRAME_DELAY_MS = 200;

/** Gap between the routes list arriving and re-selecting the cookie-saved route. */
export const ROUTE_RESTORE_SELECT_DELAY_MS = 100;

/** Minimum spinner time so the refresh button visibly reacts. */
export const REFRESH_SPINNER_MS = 500;

/** Horizontal travel (px) required for a swipe to dismiss a drawer. */
export const SWIPE_DISMISS_PX = 60;

/** Mobile/desktop split. Must match $mobile-bp in src/app/shared/_breakpoints.scss. */
export const MOBILE_BREAKPOINT_QUERY = '(max-width: 767.98px)';
