---
_id: b080c9e0-6889-11ea-85ce-67c4e28c4763
status: filled
date_posted: '2020-03-17'
layout: jobs
organization: tricoteuses
org_url: 'https://data.tricoteuses.fr/'
title: UX prototype for an Open Data repository
role: Interaction Design
compensation: gratis
deliverables: A pencil based UX prototype.
how_to_apply:
  - paulineleon@tutanota.com
github_handle: ''
tags: [ux]
date: '2020-03-17T19:58:37.079Z'
slug: "ux-prototype-for-an-open-data-repository"
---
The [Tricoteuses](https://tricoteuses.fr/a_propos) non-profit collective wants to publish [datasets](https://en.wikipedia.org/wiki/Data_set) originating from the [French national assembly](http://data.assemblee-nationale.fr/) at [data.tricoteuses.fr](https://data.tricoteuses.fr) for [software developers](https://forum.en-root.org/t/persona-developer-working-with-datasets/165) to use. Three [epics](https://forum.en-root.org/tags/epic) were written based on the [user research report](https://forum.en-root.org/t/user-research-report-developers-and-dataset-repositories/164) for [the developer persona](https://forum.en-root.org/t/persona-developer-working-with-datasets/165/):

* [get data from data.tricoteuses.fr](https://forum.en-root.org/t/developer-epic-get-data-from-data-tricoteuses-fr/166)
* [understand data from data.tricoteuses.fr](https://forum.en-root.org/t/developer-epic-understand-data-from-data-tricoteuses-fr/167)
* [update data from data.tricoteuses.fr](https://forum.en-root.org/t/developer-epic-update-data-from-data-tricoteuses-fr/168)

This is hopefully enough to create a [pencil](https://pencil.evolus.vn/) based UX prototype. The current https://data.tricoteuses.fr web site must not be used as an inspiration.

It should however be used to find out [how git repositories can be displayed](https://git.en-root.org/tricoteuses/data.tricoteuses.fr), how a [documentation page can be displayed](https://data.tricoteuses.fr/doc/assemblee/amendement.html) etc. https://data.tricoteuses.fr currently is a randomly organized collection of things the user needs. The closer a UX prototype is to how an individual thing is presented, the easier the implementation will be. For instance, the [git repositories display](https://git.en-root.org/tricoteuses/data.tricoteuses.fr) relies on the [GitLab](https://about.gitlab.com/) user interface and modifying it, even slightly, means re-implementing the user interface entirely (or maintaining a modified fork of GitLab which is even more work). A balance must be found between the desired UX and the cost of implementing it when a similar (but less effective) UX already exists in an off-the-shelf software.
