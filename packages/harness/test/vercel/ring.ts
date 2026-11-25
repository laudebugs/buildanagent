// A key ring for the Vercel tests: one 32-byte key in unpadded base64url, made for these tests and used nowhere else.
export const TEST_KEY = "dGVzdC1vbmx5LWtleS1mb3ItdmVyY2VsLXRhcmdldDE";
export const TEST_RING = JSON.stringify({ current: "2026-11", keys: { "2026-11": TEST_KEY } });
