---
title: "UX Improvement Pass + Style Guide for Colorado Mesh's Mesh Client used around the world"
status: filled
date_posted: "2026-09-25"
date: "2026-09-25T12:57:52.517Z"
slug: "ux-improvement-pass-style-guide-for-colorado-meshs-mesh-client-used-around-the-world"
last_updated: "2026-09-26"
organization: "Colorado Mesh's Mesh Client UX Review"
org_url: "https://github.com/Colorado-Mesh/mesh-client"
license: "https://github.com/Colorado-Mesh/mesh-client/blob/main/LICENSE"
role: "UX Review"
compensation: "gratis"
github_handle: "@rinchen"
tags:
  - "ux"
  - "desktop"
  - "electron"
how_to_apply:
  - "Join the #mesh-client channel on Discord: https://discord.com/invite/NX77SYan3P, then ping \"NV0N - Joey\"."
links:
  - "https://github.com/Colorado-Mesh/mesh-client/blob/main/CONTRIBUTING.md"
deliverables: |-
  Style guide and front-end mock-up demonstrating the style.
---

Howdy OSD Team!  Our pet project is now used around the world, in some cases to help bypass censorship and others to help out in emergencies and disasters. It has never had a UX pass by anyone who knows what they are doing. It needs one. We've tried to prototype some improvements, but our experiments have all ended in failure. This is because we are lacking a style guide.  We do have a codified style, flow, and accessibility features that work for our users. We want to have something more like a standard, and then we can perform a full UI audit against that standard. 

Our GPL-3 app is a desktop-only Electron app (with a Rust sidecar) that works on macOS, Linux, and Windows.  It allows for the use of Meshtastic, MeshCore, and Reticulum simultaneously and also has built-in support for emergency management and use cases (e.g., Mesh Emergency Communications Protocol as well as TAK server support). 

The app uses a dark, dense desktop “engineering dashboard” UX: near-black and slate surfaces, green brand accents, protocol-specific color coding, compact monospace technical text, bordered rounded panels, status indicators, tabs, sidebars, modals, and toasts, with restrained hover/pulse animations. It is built with Electron, React 19, TypeScript, Vite, Tailwind CSS v4, and Zustand, enhanced by Motion, Lucide icons, TanStack Virtual, Recharts, Leaflet, xterm, i18next, and emoji-picker-element, with Vitest, Testing Library, and axe supporting its accessibility-focused testing.

We'd like to have someone take a pass at improving the UX and generating a style guide. Once we confirm that the proposed style (via mock-ups) will work on our end, we'd like the designer to generate the full style guide, and we'll implement. Soliciting user requirements and technical limitations from the developers will be crucial for success.

AI assistance is authorized.

We're happy to have one person or a self-assembling team that operates independently.
