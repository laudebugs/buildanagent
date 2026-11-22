---
title: Install
description: Install the SDK and the gateway with the alpha tag, on Node 22.19 or later.
---

Install the SDK and the gateway, then check that your Node is new enough. You need this before you run any example on this site.

## Install both packages with the alpha tag

Every release is an alpha until the first stable one, and npm serves alphas under the `alpha` tag. Add the gateway too, because its adapters make the model calls. Tools declare their inputs with a schema library, and this site uses Zod:

```bash
pnpm add @buildanagent/sdk@alpha @buildanagent/gateway@alpha
pnpm add zod
```

Name the tag. A plain `pnpm add @buildanagent/sdk` installs a deprecated placeholder, because the `latest` tag stays on `0.0.0-bootstrap.0` until the first stable release.

## Use Node 22.19 or later

The packages need Node 22.19 or later. Do not start Node with `--conditions=source` in a project that installs the SDK. The SDK's validator maps that condition to a file its package does not ship, so the SDK fails to load.

## Keep your API key in your code

The gateway never reads an API key from the environment. You pass the key to an adapter yourself, so a key left in your shell cannot reach a provider by accident.

Next, [build your first agent](/start/first-agent/).

