# Security policy: report vulnerabilities privately through GitHub

buildanagent is mostly documentation, but it also runs code: verification harnesses that install third-party SDKs and execute their doc examples, plus scripts and CI workflows. A flaw in that code could leak a credential or run untrusted code on a contributor's machine or a CI runner. If you find one, report it privately through GitHub so we can fix it before the details are public.

## Report through the repository's Security tab

GitHub's private vulnerability reporting keeps a report visible only to you and the maintainers. To file one:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem, the affected files or workflow, and the steps to reproduce it, and say whether you want credit.

Please keep vulnerability details out of public issues, pull requests and discussions. If the **Report a vulnerability** button is missing, open a public issue that asks for a private channel and leave the details out of it.

## The scope covers code that runs, not the research it documents

The following parts of the repository are in scope:

- the verification harnesses under `verify/`, including their scripts, mock models and examples;
- the scripts under `scripts/`;
- the CI workflows under `.github/workflows/`;
- the packages we publish, once they exist.

Vulnerabilities in the third-party SDKs belong with their own projects. So do problems in the upstream docs mirrored under `docs/reference/*/source/`; [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) lists each upstream repository. Typos and factual errors in our documents are ordinary issues, so report them in a public issue.

## The checks run offline and never need real credentials

Every harness runs doc examples against a mock model, and `pnpm check`, `pnpm typecheck` and `pnpm test` need neither a real API key nor a network connection. Only `pnpm install` and the scripts that fetch upstream docs or the Hacker News corpus reach the network, and they read public sources without credentials. The harnesses also spawn third-party code with an allowlisted environment instead of the caller's full one ([AGENTS.md](AGENTS.md#coding-standards)). A path that lets a real credential reach a harness, or lets a doc example reach a real provider, is therefore a vulnerability worth reporting.

## What to expect after you report

A maintainer will acknowledge the report, assess it, and keep you informed in the private advisory thread. When a fix is needed, it lands through a pull request like any other change, and a maintainer can then publish the advisory once the fix merges.
