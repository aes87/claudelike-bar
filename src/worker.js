// Lab subproject Worker — strips the /claudelike-bar/ prefix from incoming
// request URLs before forwarding to the static-assets binding so the
// asset paths inside ./public can stay slug-free.
// See git-publishing/docs/lab-subdomain-hosting.md for the norm.

const PREFIX = '/claudelike-bar';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === PREFIX) {
      return Response.redirect(url.origin + PREFIX + '/', 301);
    }
    if (url.pathname.startsWith(PREFIX + '/')) {
      url.pathname = url.pathname.slice(PREFIX.length) || '/';
    }
    return env.ASSETS.fetch(new Request(url, req));
  },
};
