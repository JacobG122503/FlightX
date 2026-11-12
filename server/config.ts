// Environment is loaded by the entry point (server/index.ts or electron/env.ts) before this runs.
const clientId = process.env.OPENSKY_CLIENT_ID?.trim() || null;
const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim() || null;
const authenticated = Boolean(clientId && clientSecret);
const refreshOverride = Number(process.env.OPENSKY_REFRESH_SECONDS);

export const config = {
  port: Number(process.env.PORT ?? 8787),
  isProd: process.env.NODE_ENV === 'production',
  /** Identifies us politely to free community APIs. */
  userAgent: 'FlightX/0.1 (personal, non-commercial flight tracker)',
  opensky: {
    clientId,
    clientSecret,
    authenticated,
    /**
     * A world snapshot costs 4 credits. Anonymous: 400/day, account: 4000/day.
     * 90s anon ≈ 2.5h of continuous use per day; 30s with an account ≈ 8h.
     */
    refreshSeconds: Number.isFinite(refreshOverride) && refreshOverride >= 5 ? refreshOverride : authenticated ? 30 : 90,
  },
  /**
   * Optional contact (URL or email) for Planespotters.net. Their API only serves
   * server requests whose User-Agent includes a contact; without it, the browser
   * fetches photos directly instead.
   */
  planespottersContact: process.env.PLANESPOTTERS_CONTACT?.trim() || null,
  /** Real-time area queries accept at most 250 NM. */
  regionalMaxRadiusNm: 250,
  /** Zoomed-in refresh. Dead reckoning keeps planes moving smoothly in between. */
  regionalRefreshMs: 8000,
} as const;
