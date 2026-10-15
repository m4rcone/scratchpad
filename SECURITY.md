# Security policy

Only the latest release is supported.

## Scope

The extension stores drafts locally and makes no network requests (see
[PRIVACY.md](PRIVACY.md)); its content security policy allows nothing outside
the extension package. The main attack surface is the preview, where HTML in a
draft is sanitized with `hast-util-sanitize` under GitHub's rules. Reports of
interest show a way to run script or to issue a request despite the policy.

## Reporting

Do **not** open a public issue. Report privately at
<https://github.com/m4rcone/scratchpad/security/advisories/new>,
including the steps taken, the result, and the extension and Chrome versions.
