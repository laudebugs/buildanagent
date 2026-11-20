---
"@buildanagent/sdk": minor
---

Breaking Changes: `SafetyErrorCode` gains three codes for the safety package's USD cap on AI SDK calls: `invalid_budget` for a cap that isn't a finite number of dollars, 0 or more; `budget_exceeded` for a call refused because it would pass the cap; and `unknown_price` for a call refused because its cost can't be checked. The SDK never throws them, but a `switch` over every code now needs a case for each. `SafetyError`'s `name` is now typed `string`, so a subclass can carry its own name.
