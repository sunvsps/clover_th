/** Full-page navigation (the Discord login leaves the SPA). A seam so tests can observe it. */
export const navigate = (url: string) => window.location.assign(url);
