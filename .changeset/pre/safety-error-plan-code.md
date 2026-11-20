---
"@buildanagent/sdk": minor
---

Breaking Changes: `SafetyErrorCode` gains `invalid_plan`, the code the safety package throws for a plan approval it can't sign or show, such as one whose steps are out of order. The SDK never throws it, but a `switch` over every code now needs a case for it.
