# Self-hosted vs cloud, and invitation links

## Deployment

`STRICTBUDGET_DEPLOYMENT` is `self-hosted` (the default) or `cloud` (the hosted strictbudget).
It's an explicit setting, not guessed from the URL. Hosted-only code goes in `apps/api/src/cloud/`
and `apps/web/src/cloud/` and is reached only through `isCloud(env)`. It stays AGPL: this is about
what self-hosters don't need, not paid features. The web app reads `GET /v1/instance`
(`{ deployment, email }`).

## Self-hosted without email

Resend is required only in cloud production. Without it, a production server sends no email
(`deps.email` is null), and:

- Accounts start confirmed and sign-up signs straight in. Sign-up then says when an address is
  taken: without email there's no way to answer the same for both.
- An account left unconfirmed from when the server sent email is confirmed when it signs in.
- There's no password reset link. The forgot-password page says to ask whoever runs the server;
  the tool for that is [#116](https://github.com/ikramhasan/strictbudget/issues/116).
- Changing an account's email applies at once after the password check (`EMAIL_TAKEN` if another
  account has the address).
- Invitations can only be shared as links; resend answers `EMAIL_DISABLED`.

## Invitation links

On both deployments the owner can get an invitation's link instead of emailing it
(`sendEmail: false`, or `POST …/invitations/{id}/link` for a new one) and send it however they
like.

- Joining still needs an account with the invited address, so a forwarded link is no use to anyone
  else.
- The server keeps only the token's hash, so a link is shown once. A new link replaces the earlier
  one, emailed or shared.
- A shared-link invitation gets no expiry reminder (`budget_invitation.delivery = 'link'`), because
  the reminder's new link would replace the one the owner shared.
