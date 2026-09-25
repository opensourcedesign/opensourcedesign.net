# [opensourcedesign.net](https://opensourcedesign.net)

Website of the Open Source Design community, built with [Hugo](https://gohugo.io/) and [Tailwind CSS](https://tailwindcss.com/), hosted on GitHub Pages.

[![Backers on Open Collective](https://opencollective.com/opensourcedesign/backers/badge.svg)](#backers) [![Sponsors on Open Collective](https://opencollective.com/opensourcedesign/sponsors/badge.svg)](#sponsors) [![Follow on Mastodon](https://img.shields.io/badge/Mastodon-Follow-6364FF?logo=mastodon&logoColor=white)](https://mastodon.social/@opensourcedesign) [![Follow on Bluesky](https://img.shields.io/badge/bluesky-OpenSourceDesign-blue?logo=bluesky)](https://bsky.app/profile/opensourcedesign.net)

- Read our [Contributor Code of Conduct](https://opensourcedesign.net/about-us/code-of-conduct/). By participating in this project online or at events you agree to abide by its terms.
- Before submitting a pull request, it is best to [open an issue first](https://github.com/opensourcedesign/opensourcedesign.net/issues) to describe the suggestion and to get feedback (except it is a fix for obvious bugs or spelling mistakes).
- Please do not submit AI-generated code changes, issues, documentation, or code reviews.
- You can use & modify everything as long as you credit [Open Source Design](https://opensourcedesign.net) and use the same license for your resulting work.
  - Code: [AGPLv3](https://www.gnu.org/licenses/agpl-3.0.en.html)
  - Content: [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

## How to Contribute

There are several ways to edit content on [opensourcedesign.net](https://opensourcedesign.net), all of which require a GitHub account:

1. **Using GitHub's file editor** - Quick edits directly in your browser. Navigate to any file, click the pencil icon, and submit a pull request.

2. **Using GitHub Codespaces** - A cloud development environment in your browser with Hugo preconfigured and a live preview. From the repo menu choose **Code → Codespaces → Create codespace**, or click:

   [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/opensourcedesign/opensourcedesign.net)

3. **Setting up locally** - For more extensive development work. See the instructions below.

## Local Development Setup

### Prerequisites

Before you begin, ensure you have the following installed:

- **Hugo** (extended version; matches CI)
- **Git** - [Download Git](https://git-scm.com/)

That's all — **no Node.js or npm** required for everyday work. See [How the CSS Works](#how-the-css-works) for how styling is built locally vs on the live site. Two optional standalone binaries:

- **[Pagefind](https://github.com/Pagefind/pagefind/releases)** (*optional*) - generates the search index; only needed to test search locally (CI downloads it automatically)
- **[Tailwind standalone CLI](https://github.com/tailwindlabs/tailwindcss/releases)** (*optional*) - only needed to regenerate `compiled.css` or the vendored typography stylesheet locally

#### Installing Hugo

**macOS (using Homebrew):**
```bash
brew install hugo
```

**Linux (Debian/Ubuntu):**
```bash
# Download the extended .deb (version pinned to match CI)
wget https://github.com/gohugoio/hugo/releases/download/v0.166.0/hugo_extended_0.166.0_linux-amd64.deb
sudo dpkg -i hugo_extended_0.166.0_linux-amd64.deb

# Verify installation
hugo version
```

**Linux (Arch):**
```bash
sudo pacman -S hugo
```

**Linux (Fedora):**
```bash
sudo dnf install hugo
```

**Windows (using Chocolatey):**
```bash
choco install hugo-extended
```

**Windows (using Scoop):**
```bash
scoop install hugo-extended
```

For other platforms, download from the [Hugo releases page](https://github.com/gohugoio/hugo/releases).

### Installation Steps

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR-USERNAME/opensourcedesign.net.git
   cd opensourcedesign.net
   ```

2. **Start the development server**

   ```bash
   hugo server
   ```

   That's it — styling works out of the box. See [How the CSS Works](#how-the-css-works) for what happens behind the scenes.

3. **Open your browser** at `http://localhost:1313/`

#### Working on styles

No build step: edit `assets/css/main.css` (custom theme, components, base styles) or add any standard Tailwind utility class to templates in `layouts/` — both take effect on the next reload with plain `hugo server`.

The only exception is `prose-*` typography classes: since the Play CDN cannot load Tailwind plugins, the `@tailwindcss/typography` styles are pre-compiled into the checked-in `assets/css/typography.css`. If you need a `prose-*` class that isn't in there yet, add it to `assets/css/typography.src.css` and regenerate with the [Tailwind standalone CLI](https://github.com/tailwindlabs/tailwindcss/releases) (a single executable — it bundles the typography plugin, so no Node.js or npm is required):

```bash
tailwindcss -i assets/css/typography.src.css -o assets/css/typography.css --minify
# rebuilds assets/css/typography.css - commit it
```

## How the CSS Works

The site's look-and-feel comes from Tailwind utility classes in the HTML templates (`layouts/`) plus custom rules in `assets/css/main.css`. Together they are compiled into **`assets/css/compiled.css`**. That file is **not checked into Git** (it is in `.gitignore`) and must be generated before a production build.

**On the deployed website**, [GitHub Actions](.github/workflows/hugo-build.yml) generate it on every deploy.

**For local testing**, you have two options:

1. **Just run Hugo** (`hugo server`) — no CSS build needed. If `compiled.css` is missing, [`layouts/_default/baseof.html`](layouts/_default/baseof.html) falls back to the [Tailwind Play CDN](https://tailwindcss.com/docs/installation/play-cdn) (loaded from [jsDelivr](https://www.jsdelivr.com/)): your browser builds the styles on the fly from the page markup and inlined `main.css`.
2. **Match production** — compile the CSS yourself, then run Hugo:
   ```bash
   npx @tailwindcss/cli -i assets/css/main.css -o assets/css/compiled.css --minify
   hugo server
   ```
   (Or use the [Tailwind standalone CLI](https://github.com/tailwindlabs/tailwindcss/releases) — no Node.js needed.)

`assets/css/dark-theme.css` is always loaded as a separate file (dark-mode overrides). Article typography (`prose` classes) uses the checked-in `assets/css/typography.css` — see *Working on styles* above to regenerate it.

## Project Structure

```
opensourcedesign.net/
├── .devcontainer/    # GitHub Codespaces config (Hugo + preview on port 1313)
├── .github/
│   ├── path-filters.yml  # Shared CI path allowlists (site / content / forms)
│   ├── scripts/      # announce-jobs.mjs - posts new jobs to Mastodon & Bluesky
│   └── workflows/    # hugo-build (deploy), job-approved-email / job-rejected-email,
│                     # job-expire (daily auto-expiry), job-announce (social media),
│                     # content-lint (PR checks), preview (PR previews), link-check (weekly)
├── archetypes/       # Hugo content templates for new pages
├── assets/
│   └── css/
│       ├── main.css            # Custom styles + Tailwind theme (source for compiled.css)
│       ├── dark-theme.css      # Dark-mode overrides (always loaded)
│       ├── compiled.css        # Generated at build time (gitignored — see “How the CSS Works”)
│       ├── typography.src.css  # Source/safelist for the typography (prose) bundle
│       └── typography.css      # Pre-compiled prose styles (regenerate via Tailwind CLI, don't edit)
├── content/          # All website content in Markdown
│   ├── about-us/     # About, manifesto, governance, by-laws, code of conduct, how to join
│   ├── events/       # Event announcements and write-ups
│   ├── jobs/         # Job listings
│   ├── resources/    # Curated directory + sub-pages: articles/ and reading.md (bibliography)
│   └── ...           # Standalone pages (forum, imprint, brand, etc.)
├── data/             # YAML data files for dynamic content
├── layouts/          # Hugo HTML templates
├── static/           # Static assets (images, fonts, downloads)
│   └── images/
│       └── brand/    # Official logos and branding assets
├── hugo.toml         # Hugo configuration
└── workers/          # Cloudflare Worker for the job, event & resource submission forms (deployed separately)
```

## Development Commands

| Command | Description |
|---------|-------------|
| `hugo server` | Start the development server with live reload |
| `hugo --minify --gc` | Build the site for production into `public/` |
| `pagefind --site public` | Generate the Pagefind search index (standalone binary, runs after the Hugo build) |
| `npx @tailwindcss/cli -i assets/css/main.css -o assets/css/compiled.css --minify` | Build production CSS (optional locally; CI does this automatically) |
| `tailwindcss -i assets/css/typography.src.css -o assets/css/typography.css --minify` | Regenerate the vendored `prose` stylesheet (standalone binary) |

## Continuous integration

GitHub Actions workflows skip expensive Hugo builds when a change cannot affect the live site. Path allowlists live in [`.github/path-filters.yml`](.github/path-filters.yml):

| Filter | Paths | Used by |
|--------|-------|---------|
| `site` | `content/`, `data/`, `layouts/`, `assets/`, `static/`, `hugo.toml`, … | Production deploy, PR previews, accessibility checks |
| `content` | Job/event/resource markdown and curated YAML | Content lint |
| `forms` | Submission form layouts and JS modules | Documented for form-related checks |

**Production** ([`hugo-build.yml`](.github/workflows/hugo-build.yml)) runs on pushes to `main` only when `site` paths change. Use *Actions → Build and Deploy Hugo → Run workflow* to force a full deploy (e.g. after a docs-only merge when you want to refresh caches).

**Pull requests:** the preview and accessibility workflows always start, but the Hugo build step is skipped when the PR touches only docs, README, or `workers/`. A bot comment notes when the preview was skipped. Preview cleanup on PR close always runs so `gh-pages/pr-preview/` does not accumulate stale folders.

**Cheap checks** ([`ci-checks.yml`](.github/workflows/ci-checks.yml), [`content-lint.yml`](.github/workflows/content-lint.yml)) still run when their respective paths change; content lint only examines files changed in the commit or PR, not the entire corpus.

> **Search:** Search is a site-wide modal (opened from the header search button, or with <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> or <kbd>/</kbd>), powered by [Pagefind](https://pagefind.app/). The index lives in `public/pagefind/` and is generated by running the `pagefind` binary against the built site; the Pagefind assets are lazy-loaded the first time the dialog is opened. During `hugo server` the index is not built, so the modal only returns results after a production build followed by `pagefind --site public`.

> **Images:** Markdown images are processed through Hugo's asset pipeline (`layouts/partials/resolve-image.html`). Local raster images placed under `assets/images/` are automatically down-scaled and served as AVIF + WebP with the original as a fallback, with intrinsic `width`/`height` to avoid layout shift. SVGs, GIFs, and external URLs are passed through untouched.

## Technology Stack

- **[Hugo](https://gohugo.io/)** - Fast static site generator written in Go
- **[Tailwind CSS v4](https://tailwindcss.com/)** - Utility-first CSS framework; compiled in the browser via the [Play CDN](https://tailwindcss.com/docs/installation/play-cdn) locally, or ahead of time by GitHub Actions in production (see [How the CSS Works](#how-the-css-works))
- **[@tailwindcss/typography](https://tailwindcss.com/docs/typography-plugin)** - Beautiful typographic defaults for Markdown content (pre-compiled into `assets/css/typography.css`)
- **[Inter](https://rsms.me/inter/)** - Self-hosted variable font (woff2, in `static/fonts/`)
- **[Pagefind](https://pagefind.app/)** - Static, client-side search index generated at build time

## Editing Content

All content lives as Markdown in `content/`. The site uses the following sections after the information-architecture overhaul:

| Section | Path | What it holds |
|---------|------|---------------|
| About Us | `content/about-us/` | About page, manifesto, governance, by-laws, code of conduct, how to join |
| Events | `content/events/` | Event announcements and write-ups — or use the [event form](https://opensourcedesign.net/events/event-form/) |
| Jobs | `content/jobs/` | Job listings — or use the [job form](https://opensourcedesign.net/jobs/job-form/) |
| Resources | `content/resources/` | Hub page with sub-pages: the curated links directory at `/resources/links/` (suggest new links via the [suggest form](https://opensourcedesign.net/resources/suggest/)), the bibliography at `/resources/bibliography/` (`/resources/reading/` redirects there), and community articles at `/resources/articles/` (`/articles/` redirects there) |
| Standalone | `content/*.md` | `forum`, `imprint`, `brand`, and the homepage (`_index.md`) |

### Editing Process

The recommended workflow for any content change:

1. **Edit the Markdown** in the relevant `content/` folder (see the table above). For quick fixes use GitHub's pencil icon; for larger work, set up the project locally and run `hugo server` to preview.
2. **Preview locally** at `http://localhost:1313/` to confirm formatting, front matter, and links render correctly.
3. **Open a pull request.** Content PRs are reviewed by two Open Source Design community members before they are merged and published.
4. **Cross-team content edits** (copy rewrites, page merges) are coordinated by the community - major restructuring is tracked in the project's GitHub issues before landing on a branch.

> Note: the `articles/` and `people/` sections were removed in the IA overhaul. Article-style content now lives under **Resources**, and contributor profiles are handled on the forum and the *How to Join* page.

### Adding a Job Post

1. Navigate to `content/jobs/`
2. Create a new `.md` file following the existing format (date-prefixed filename, e.g. `2025-03-15-role-title.md`)
3. Or use the online form at [opensourcedesign.net/jobs/job-form/](https://opensourcedesign.net/jobs/job-form/)

Links in `how_to_apply` automatically get a recognisable service icon on the job page (GitHub, GitLab, Codeberg, F-Droid, Figma, Matrix, LinkedIn, app stores, …) based on the URL's host; unknown hosts fall back to a generic link icon and emails get an envelope. To support another service, add a host rule and its SVG path to `layouts/partials/apply-icon.html`.

The form has a **Preview** button that renders the posting client-side (badges, description Markdown, deliverables, apply links) exactly as it will appear, updating live while you type. Paid postings can also carry a **structured rate** (`rate_min`, optional `rate_max`, `rate_currency`, `rate_period` front matter) which renders as e.g. "€50–75 per hour" in the job page's Details card; the free-text `paid_details` remains for notes like "negotiable".

On submission the Worker runs a **duplicate check** against the live job index (`/jobs/index.json`, built by Hugo from `layouts/jobs/section.json.json`): if an open posting with the same or a very similar title exists, the form shows it and asks for confirmation before creating the PR.

To update an existing posting (fix details, mark it as filled or closed), use the "Edit this posting" link in the sidebar of the job's page - it opens the same form prefilled, and submits a moderated pull request that updates the file in place.

Around six weeks after publication, posters of still-open jobs get a **reminder email** asking whether the position is still open (`job-reminder.yml`, weekly; it maps each file back to its submission PR and pulls the email from the Worker's KV store - manually committed postings are skipped).

**Expiration:** postings can carry an optional `deadline: YYYY-MM-DD` (application deadline, settable from the form). Once the deadline passes, the posting shows an "expired" notice and moves from `/jobs/` to `/jobs/archive/`. A daily GitHub Action (`job-expire.yml`) also flips `status: searching` to `status: expired` when the deadline has passed, or when a posting is over a year old with no update - so the front matter catches up with what the site already shows. Re-open an expired posting by editing it and selecting "Still searching" (clear or move the deadline first).

**Feeds:** besides the main `/jobs/feed.xml`, filtered feeds exist at `/jobs/feed-paid.xml` and `/jobs/feed-volunteer.xml` (linked from the jobs page) so people can subscribe only to the postings they care about.

**Social cards:** every job page gets a generated 1200×630 Open Graph image (horizontal brand logo, title, organization, paid/volunteer, deadline on a light slate-50 background) so shared links unfurl nicely. They're built by `layouts/partials/social-card.html` from the committed `assets/images/og-card-base.png` plus the Inter fonts in `assets/fonts/og/`; Hugo composites the job-specific text at build time. A posting with an explicit `image` front matter keeps that image instead.

**Content lint:** pull requests touching `content/jobs/` or `content/events/` run `content-lint.yml`, which validates front matter (required fields, status enums, ISO dates) and catches the classic Markdown pitfalls (4-space indents rendering as code blocks, `###Heading` without a space, `•` pseudo-bullets) before a broken page can be merged.

### Social Media Announcements

When a push to `main` adds a new file under `content/jobs/` (i.e. a submission PR was merged, or a maintainer committed a posting directly), the `job-announce.yml` workflow posts it to Mastodon and Bluesky using `.github/scripts/announce-jobs.mjs` - no third-party services involved. It waits for the job page to be live (the Hugo deploy runs in parallel), announces only fresh `status: searching` postings (dated within 14 days, so bulk imports and renames never spam the feeds), and caps posts per run. Posters can opt out on the job form (`announce_social: false` in front matter); older postings without that field are announced as before.

Each platform is optional - configure its repo secrets to enable it:

| Platform | Secrets | Where to get them |
| -------- | ------- | ----------------- |
| Mastodon | `MASTODON_URL`, `MASTODON_ACCESS_TOKEN` | On the account's instance: Preferences → Development → New application, scope `write:statuses`. `MASTODON_URL` is the instance base URL, e.g. `https://mastodon.online`. |
| Bluesky | `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` (optional `BLUESKY_SERVICE`) | `BLUESKY_IDENTIFIER` is the handle (e.g. `opensourcedesign.net`); create the app password under Settings → Privacy and Security → App Passwords. Don't use the account password. |

To announce a posting manually (retry, or one that predates the workflow), run *Announce new jobs on social media* from the Actions tab with the file path - there's also a dry-run option that composes the posts without publishing. Missed announcements never block a merge: the workflow only reads the repo and fails loudly in the Actions log.

### Adding an Event

1. Navigate to `content/events/`
2. Create a new `.md` file (date-prefixed for announcements, or a short slug for write-ups, e.g. `fosdem-2026.md`)
3. Fill in the front matter with event details (`title`, `eventDate`, `status`, location, etc.)
4. Or use the online form at [opensourcedesign.net/events/event-form/](https://opensourcedesign.net/events/event-form/), which opens a moderated pull request for you (handled by the same Cloudflare Worker as the job and resource forms)

To update an existing event (fix details, mark it as cancelled), use the "Edit this event" link at the bottom of the event's page - it opens the same form prefilled, and submits a moderated pull request that updates the file in place.

> **Announcements vs. write-ups:** add an `author` to the front matter to mark a page as a **write-up / recap**. Those entries get a "Recap" card (with a thumbnail pulled from the first image in the body) in the *Write-ups & Recaps* column on `/events/` and surface on the homepage. Pages without an `author` are treated as plain listings. Set `status` to `upcoming`/`started` to appear in the *Upcoming* list, or `past`/`cancelled` to move into the archive.
>
> **Add an `endDate` (a machine-readable date, e.g. `endDate: 2026-02-01`) to dated events.** Once that date passes, the event is automatically dropped from *Upcoming* and moved into *Past Events* even if its `status` still says `upcoming` - so a forgotten status never leaves a finished event sitting at the top of the page.

### Updating Resources

1. To add, change, or remove a curated tool or link, edit `data/resources.yaml` - each entry is a few YAML lines (`name`, `url`, optional `description` and extra `links`), grouped into categories. No HTML or template knowledge needed; the file's header comment documents the format. Non-Git users can use the [suggest form](https://opensourcedesign.net/resources/suggest/) instead (linked from `/resources/links/`) - it opens a moderated pull request that inserts the entry into the right category, via the same Cloudflare Worker as the job and event forms.
2. To add a talk, article, paper, or book to the **Bibliography**, add an entry to `data/bibliography.yaml`.
3. Both lists render wherever their shortcode is placed in a page's Markdown: `{{</* resources */>}}` for the filterable directory (in `content/resources/links.md`) and `{{</* bibliography */>}}` for the bibliography (in `content/resources/bibliography.md`, with `heading="false"` since the page provides its own title). Move or copy a shortcode to relocate its list.
4. New resource sub-pages (e.g. the guide texts proposed in issue #554) are Markdown files in `content/resources/` with `layout: resource-page` and a `weight` that controls their order on the `/resources/` hub. Two of the four proposed guides are still draft placeholders - fill in the body and remove `draft: true` to publish.

### Editing an About Us Page

1. Navigate to `content/about-us/`
2. Edit the relevant Markdown file (`_index.md`, `manifesto.md`, `governance.md`, `by-laws.md`, `code-of-conduct.md`)

### Further Documentation

Additional contributor guides live in the [`docs/`](docs/) folder - including the [moderation guide](docs/moderation-guide.md) for maintainers reviewing job, event, and resource submissions.

## Data Files

Content that appears on multiple pages is managed through YAML files in `data/`:

| File | Description |
|------|-------------|
| `social.yaml` | Social media links and icons |
| `supporters.yaml` | Supporter/sponsor logos |
| `conferences.yaml` | Conference partnerships |
| `affiliates.yaml` | Affiliate organizations |
| `tools.yaml` | Featured open source design tools (homepage) |
| `resources.yaml` | Curated resources directory shown on `/resources/links/` |
| `bibliography.yaml` | Bibliography shown on `/resources/bibliography/` |
| `quicklinks.yaml` | Footer navigation links |
| `summits.yaml` | Past summit event information |

## Styling Guidelines

The site uses Tailwind CSS v4 with CSS-based configuration. See [How the CSS Works](#how-the-css-works) for the full compile/fallback pipeline. To modify styles:

1. Edit `assets/css/main.css` for custom components and base styles (it supports the full Tailwind syntax, including `@apply` and `@theme`, and is the single source for both pipelines)
2. Edit `assets/css/dark-theme.css` for dark-mode overrides
3. Use Tailwind utility classes directly in HTML templates (`layouts/`)
4. Run `hugo server` to see changes with live reload
5. Only `prose-*` typography classes are pre-compiled - see *Working on styles* above if you need a new one

Custom component classes (prefixed with `osd-`) are defined in `main.css`:
- `.osd-card` - Card component styling
- `.osd-pill` - Tag/badge styling
- `.osd-btn-primary` - Primary call-to-action button
- `.osd-prose` - Article content styling
- `.osd-lightbox-*` - Image lightbox components

## 👩‍🚀 Contributors, Backers & Sponsors

This project exists thanks to all the **people who contribute**.

<a href="https://github.com/opensourcedesign/opensourcedesign.net/graphs/contributors"><img src="https://contrib.rocks/image?repo=opensourcedesign/opensourcedesign.net" alt="Contributors to opensourcedesign.net" /></a>

Thank you to **all our backers**! 🙏 ([Become a backer](https://opencollective.com/opensourcedesign#backer))

<a href="https://opencollective.com/opensourcedesign#backers" target="_blank"><img src="https://opencollective.com/opensourcedesign/backers.svg?width=890"></a>

**Support this project by becoming a sponsor.** ([Become a sponsor](https://opencollective.com/opensourcedesign#sponsor))

<a href="https://opencollective.com/opensourcedesign/sponsor/0/website" target="_blank"><img src="https://opencollective.com/opensourcedesign/sponsor/0/avatar.svg"></a>

## ♥ Code of Conduct

Please note that Open Source Design has a [Contributor Code of Conduct](https://opensourcedesign.net/about-us/code-of-conduct/). By participating in this project online or at events you agree to abide by its terms.

## 📜 License

**🔀 You can use & modify everything as long as you credit [Open Source Design](https://opensourcedesign.net) and use the same license for your resulting work.**

- Code: [AGPLv3](https://www.gnu.org/licenses/agpl-3.0.en.html)
- Content: [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
