---
"@buildanagent/gateway": minor
---

Breaking Changes: mockTransport() now records credential header values and URL keys as `[redacted]`, so `requests[n].headers["x-api-key"]` no longer holds the key an adapter sent. A test that needs it wraps the transport in a function that reads `request.headers` before passing the request on.
