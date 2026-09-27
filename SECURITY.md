# Security policy

Only the latest release is supported.

## Scope

The extension stores drafts locally and makes no network requests (see
[PRIVACY.md](PRIVACY.md)); the manifest's content security policy allows
nothing outside the extension package. The interesting reports are about the
preview, where HTML in a draft is sanitized with `hast-util-sanitize` under
GitHub's rules: a way to run script, or to make the page issue a request despite
the policy.

## Reporting

Please **do not open a public issue**. Report it privately under
**Security → Report a vulnerability**:
<https://github.com/m4rcone/scratchpad-newtab/security/advisories/new>.

Say what you did, what happened, and which version and Chrome build you used.
