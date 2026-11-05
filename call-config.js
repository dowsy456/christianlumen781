/* Public browser configuration. Never put a provider API key or TURN shared secret here.
 * See CALLING.md for the endpoint response and deployment checks.
 * This deployment retains STUN and supports UDP, TCP and TLS relay paths.
 */
globalThis.CHAT_CALL_CONFIG = globalThis.CHAT_CALL_CONFIG || {
  // Recommended: your authenticated HTTPS service returns short-lived credentials.
  // Use an absolute HTTPS URL if people also open index.html through file://.
  // iceServersEndpoint: 'https://your-calling-service.example/ice',

  // Optional auth hook for that service (example requires Firebase Authentication):
  // getIceAuthorization: async () => 'Bearer ' + await firebase.auth().currentUser.getIdToken(),

  // Deployment-provided TURN client credentials; direct STUN stays available.
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:80?transport=tcp',
        'turn:global.relay.metered.ca:443',
        'turns:global.relay.metered.ca:443?transport=tcp'
      ], username: '784bf0e7495f2e61a4d0b3d1', credential: 'kTyBfUPudYnOGkyV' }
  ],

  iceTransportPolicy: 'all',
  // Screens are sent only to people who explicitly open them. Set true only
  // for compatibility with old clients that do not publish viewer presence.
  streamScreenToAll: false
};

// Public URL only. Deploy the free B2/Cloudflare Worker in README.md, then paste
// its HTTPS address here. B2 application keys belong in Worker secrets, never
// in this public repository. Empty means new file uploads need setup.
globalThis.CHAT_FILE_CONFIG = globalThis.CHAT_FILE_CONFIG || {
  endpoint: 'https://chatapp-files.sackednightmares.workers.dev'
};
