# The npm placeholders before the L11 release

Before todo [L11](../../todos/done/L11-bootstrap-and-release-protocol-harness-cli.md) publishes the first alpha of four of the six `@buildanagent` packages, npm holds a deprecated placeholder of each of those four. This file records that state as the output for L11's pull request description, as [PB4](../publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) asks. Every command below only reads from the registry. The session ran them at about 18:25 UTC on 2026-11-22, with npm's default public registry and no login.

## What the output shows

npm holds every placeholder PB4 expects, and every placeholder is deprecated:

- **The four new packages.** `@buildanagent/agent-safety`, `@buildanagent/protocol`, `@buildanagent/harness` and `@buildanagent/cli` each hold only `0.0.0-bootstrap.0` and `0.0.0-stage`, with `latest` and `bootstrap` on `0.0.0-bootstrap.0` and no `alpha` tag yet. Both versions of all four print "Placeholder only; install 0.1.0 or later." as their deprecation, so the owner has no deprecation left to add.
- **The gateway and the SDK.** Each holds the two placeholders, also deprecated, and `0.1.0-alpha.0` to `0.1.0-alpha.27`, with `alpha` on `0.1.0-alpha.27` and `latest` still on `0.0.0-bootstrap.0`. `0.1.0-alpha.27` isn't deprecated. L11's version commit moves all six to `0.1.0-alpha.28`.

`npm view <name> deprecated` reports only the version `latest` names, so the second section asks for each placeholder version by name.

## `npm view @buildanagent/<name> name versions dist-tags deprecated`

```text
$ npm view @buildanagent/gateway name versions dist-tags deprecated
name = '@buildanagent/gateway'
versions = [
  '0.0.0-bootstrap.0', '0.0.0-stage',
  '0.1.0-alpha.0',     '0.1.0-alpha.1',
  '0.1.0-alpha.2',     '0.1.0-alpha.3',
  '0.1.0-alpha.4',     '0.1.0-alpha.5',
  '0.1.0-alpha.6',     '0.1.0-alpha.7',
  '0.1.0-alpha.8',     '0.1.0-alpha.9',
  '0.1.0-alpha.10',    '0.1.0-alpha.11',
  '0.1.0-alpha.12',    '0.1.0-alpha.13',
  '0.1.0-alpha.14',    '0.1.0-alpha.15',
  '0.1.0-alpha.16',    '0.1.0-alpha.17',
  '0.1.0-alpha.18',    '0.1.0-alpha.19',
  '0.1.0-alpha.20',    '0.1.0-alpha.21',
  '0.1.0-alpha.22',    '0.1.0-alpha.23',
  '0.1.0-alpha.24',    '0.1.0-alpha.25',
  '0.1.0-alpha.26',    '0.1.0-alpha.27'
]
dist-tags = {
  latest: '0.0.0-bootstrap.0',
  bootstrap: '0.0.0-bootstrap.0',
  alpha: '0.1.0-alpha.27'
}
deprecated = 'Placeholder only; install 0.1.0 or later.'

$ npm view @buildanagent/sdk name versions dist-tags deprecated
name = '@buildanagent/sdk'
versions = [
  '0.0.0-bootstrap.0', '0.0.0-stage',
  '0.1.0-alpha.0',     '0.1.0-alpha.1',
  '0.1.0-alpha.2',     '0.1.0-alpha.3',
  '0.1.0-alpha.4',     '0.1.0-alpha.5',
  '0.1.0-alpha.6',     '0.1.0-alpha.7',
  '0.1.0-alpha.8',     '0.1.0-alpha.9',
  '0.1.0-alpha.10',    '0.1.0-alpha.11',
  '0.1.0-alpha.12',    '0.1.0-alpha.13',
  '0.1.0-alpha.14',    '0.1.0-alpha.15',
  '0.1.0-alpha.16',    '0.1.0-alpha.17',
  '0.1.0-alpha.18',    '0.1.0-alpha.19',
  '0.1.0-alpha.20',    '0.1.0-alpha.21',
  '0.1.0-alpha.22',    '0.1.0-alpha.23',
  '0.1.0-alpha.24',    '0.1.0-alpha.25',
  '0.1.0-alpha.26',    '0.1.0-alpha.27'
]
dist-tags = {
  bootstrap: '0.0.0-bootstrap.0',
  latest: '0.0.0-bootstrap.0',
  alpha: '0.1.0-alpha.27'
}
deprecated = 'Placeholder only; install 0.1.0 or later.'

$ npm view @buildanagent/agent-safety name versions dist-tags deprecated
name = '@buildanagent/agent-safety'
versions = [ '0.0.0-bootstrap.0', '0.0.0-stage' ]
dist-tags = { latest: '0.0.0-bootstrap.0', bootstrap: '0.0.0-bootstrap.0' }
deprecated = 'Placeholder only; install 0.1.0 or later.'

$ npm view @buildanagent/protocol name versions dist-tags deprecated
name = '@buildanagent/protocol'
versions = [ '0.0.0-bootstrap.0', '0.0.0-stage' ]
dist-tags = { bootstrap: '0.0.0-bootstrap.0', latest: '0.0.0-bootstrap.0' }
deprecated = 'Placeholder only; install 0.1.0 or later.'

$ npm view @buildanagent/harness name versions dist-tags deprecated
name = '@buildanagent/harness'
versions = [ '0.0.0-bootstrap.0', '0.0.0-stage' ]
dist-tags = { bootstrap: '0.0.0-bootstrap.0', latest: '0.0.0-bootstrap.0' }
deprecated = 'Placeholder only; install 0.1.0 or later.'

$ npm view @buildanagent/cli name versions dist-tags deprecated
name = '@buildanagent/cli'
versions = [ '0.0.0-bootstrap.0', '0.0.0-stage' ]
dist-tags = { latest: '0.0.0-bootstrap.0', bootstrap: '0.0.0-bootstrap.0' }
deprecated = 'Placeholder only; install 0.1.0 or later.'
```

## Each placeholder version's deprecation

```text
$ npm view @buildanagent/gateway@0.0.0-bootstrap.0 deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/gateway@0.0.0-stage deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/sdk@0.0.0-bootstrap.0 deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/sdk@0.0.0-stage deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/agent-safety@0.0.0-bootstrap.0 deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/agent-safety@0.0.0-stage deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/protocol@0.0.0-bootstrap.0 deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/protocol@0.0.0-stage deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/harness@0.0.0-bootstrap.0 deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/harness@0.0.0-stage deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/cli@0.0.0-bootstrap.0 deprecated
Placeholder only; install 0.1.0 or later.
$ npm view @buildanagent/cli@0.0.0-stage deprecated
Placeholder only; install 0.1.0 or later.
```
